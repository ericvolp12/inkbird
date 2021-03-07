const IBS_TH1 = require("./ibs_th1");
const log4js = require("log4js");

const logger_ = log4js.getLogger();
logger_.level = "info";

const device = new IBS_TH1();

let state = {
  connecting: false,
  gotData: false,
  waitCount: 60,
  triggerTemp: 20,
  triggerMinutes: 5,
  lastPowerReset: new Date(0),
  cooldownMin: 60,
  powerCycleWaitTime: 15,
};

let sensorState = {
  temps: [],
  battery: 0,
  lastUpdated: new Date().toString("en-US"),
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
  sensorState.lastUpdated = new Date().toString("en-US");

  state.gotData = true;
  device.unsubscribeRealtimeData();
  logger_.debug("Disconnecting from sensor");
};

const dutyLoop = function () {
  // Evaluate state
  const now = new Date();
  if (now - state.lastPowerReset > state.cooldownMin * 60000) {
    if (
      sensorState.temps
        .slice(-state.triggerMinutes)
        .filter((temp) => temp > state.triggerTemp).length >=
      state.triggerMinutes
    ) {
      logger_.info(
        `Freezer has been over trigger temp of (${state.triggerTemp}F) for at least (${state.triggerMinutes}) minutes.`
      );
      if (now - state.lastPowerReset > state.triggerMinutes * 60000) {
        logger_.info(
          `Resetting fridge power, last reset was at (${state.lastPowerReset.toLocaleString(
            "en-US"
          )})`
        );
        state.lastPowerReset = now;
        setFridgeState("off");
        setTimeout(() => {
          logger_.info(
            `Powering fridge back on after (${state.powerCycleWaitTime}) minutes...`
          );
          setFridgeState("on");
        }, state.powerCycleWaitTime * 60000);
      }
    }
  }

  if (!state.connecting && state.waitCount >= 60) {
    device.subscribeRealtimeData(callback);
    logger_.debug("Connecting to sensor");
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

const axios = require("axios");

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


const express = require("express");
const app = express();
const port = 3000;

app.get("/sensor_state", (req, res) => {
  res.json({
    sensorState,
    state
  });
});

app.listen(port, () => {
  console.log(`Fridgemon API listening at http://10.0.7.5:${port}`);
});

logger_.info("Starting duty loop...");
setInterval(dutyLoop, 1000);
