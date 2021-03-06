const IBS_TH1 = require('./ibs_th1');
const log4js = require('log4js')

const logger_ = log4js.getLogger();
logger_.level = 'info';

const device = new IBS_TH1();


let state = {
  connecting: false,
  gotData: false,
  waitCount: 60
}

let sensorState = {
  temps: [],
  battery: 0,
  lastUpdated: new Date().toString('en-US')
}


const callback = data => {
  logger_.debug(`Current Temp: ${data.temperature.toFixed(2)}°F -` +
    ` Battery: ${data.battery}%`);
  sensorState.battery = data.battery;
  if(sensorState.temps.length > 60){
    sensorState.temps.shift();
  }
  sensorState.temps.push(data.temperature.toFixed(3));
  sensorState.lastUpdated = new Date().toString('en-US');

  state.gotData = true;
  device.unsubscribeRealtimeData();
  logger_.debug('Disconnecting from sensor');
};


const dutyLoop = function () {
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
}

/*
const report = function(){
  logger_.info(`Sensor State:\n\tTemps: ${sensorState.temps.map(temp => temp.toFixed(2))}\n\tBattery: ${sensorState.battery}`);
}
*/

const express = require('express')
const app = express()
const port = 3000

app.get('/sensor_state', (req, res) => {
  res.json(sensorState);
});

app.listen(port, () => {
  console.log(`Example app listening at http://10.0.7.5:${port}`);
});

logger_.info("Starting duty loop...");
setInterval(dutyLoop, 1000);
//setInterval(report, 10000);

