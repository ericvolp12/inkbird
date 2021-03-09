const IBS_TH1 = require('./ibs_th1');
const log4js = require('log4js');

const logger_ = log4js.getLogger();
logger_.level = 'info';

const device = new IBS_TH1();

const promClient = require('prom-client');
const tempPointsCaptured = new promClient.Counter({
  name: 'temperature_points_captured',
  help: 'Number of temperature datapoints captured from the sensor',
});

const fridgeResets = new promClient.Counter({
  name: 'fridge_resets',
  help: 'Number of times the fridge has had its power reset',
});

const tempGauge = new promClient.Gauge({
  name: 'current_temperature',
  help: 'Current freezer temperature from the sensor',
});

let state = {
  connecting: false,
  gotData: false,
  waitCount: 60,
  triggerTemp: 25,
  triggerMinutes: 10,
  powerResets: [
    {
      time: new Date(0),
      timeReadable: new Date(0).toLocaleString('en-US'),
    },
  ],
  cooldownMin: 90,
  powerCycleWaitTime: 15,
};

let sensorState = {
  temps: [],
  battery: 0,
  lastUpdated: new Date().toLocaleString('en-US'),
};

const callback = (data) => {
  logger_.debug(
    `Current Temp: ${data.temperature.toFixed(2)}°F -` +
      ` Battery: ${data.battery}%`
  );
  sensorState.battery = data.battery;
  if (sensorState.temps.length > 60) {
    sensorState.temps.shift();
  }
  sensorState.temps.push(data.temperature.toFixed(3));
  sensorState.lastUpdated = new Date().toLocaleString('en-US');
  tempPointsCaptured.inc();
  tempGauge.set(Number(data.temperature.toFixed(3)));

  state.gotData = true;
  device.unsubscribeRealtimeData();
  logger_.debug('Disconnecting from sensor');
};

const dutyLoop = function () {
  // Evaluate state
  const now = new Date();
  if (now - state.powerResets.slice(-1)[0].time > state.cooldownMin * 60000) {
    if (
      sensorState.temps
        .slice(-state.triggerMinutes)
        .filter((temp) => temp > state.triggerTemp).length >=
      state.triggerMinutes
    ) {
      logger_.info(
        `Freezer has been over trigger temp of (${state.triggerTemp}F) for at least (${state.triggerMinutes}) minutes.`
      );
      if (
        now - state.powerResets.slice(-1)[0].time >
        state.triggerMinutes * 60000
      ) {
        logger_.info(
          `Resetting fridge power, last reset was at (${
            state.powerResets.slice(-1)[0].timeReadable
          })`
        );
        if (state.powerResets.length > 1000) {
          state.powerResets.shift();
        }
        state.powerResets.push({
          time: now,
          timeReadable: now.toString('en-US'),
        });
        fridgeResets.inc();
        setFridgeState('off');
        setTimeout(() => {
          logger_.info(
            `Powering fridge back on after (${state.powerCycleWaitTime}) minutes...`
          );
          setFridgeState('on');
        }, state.powerCycleWaitTime * 60000);
      }
    }
  }

  if (!state.connecting && state.waitCount >= 60) {
    device.subscribeRealtimeData(callback);
    logger_.debug('Connecting to sensor');
    state.connecting = true;
  } else if (!state.connecting) {
    state.waitCount++;
  } else {
    if (state.gotData) {
      state.gotData = false;
      state.waitCount = 0;
      state.connecting = false;
    }
  }
};

const axios = require('axios');

const setFridgeState = function (desiredState) {
  axios
    .post(process.env.OUTLET_URL, {
      apiKey: process.env.OUTLET_API_KEY,
      device: process.env.OUTLET_DEVICE_NAME,
      powerState: desiredState,
    })
    .then((res) => {
      logger_.info(
        `Successfully set fridge to state (${desiredState}): `,
        res.data
      );
    })
    .catch((err) => {
      logger_.error(`Failed to set fridge to state (${desiredState}): `, err);
    });
};

const express = require('express');
const app = express();
const port = 3000;

app.get('/sensor_state', (req, res) => {
  res.json({
    sensorState,
    state,
  });
});

app.get('/metrics', (req, res) => {
  logger_.debug("Prometheus metrics scraped...");
  promClient.register.metrics().then(metrics => {
    res.send(metrics);
  }).catch(err =>{
    res.err(err);
  });
})

app.listen(port, () => {
  logger_.info(`Fridgemon API listening at http://0.0.0.0:${port}`);
});

logger_.info('Starting duty loop...');
setInterval(dutyLoop, 1000);
