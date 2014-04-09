/* ===========================================================
# sphere-stock-xml-import - v0.3.8
# ==============================================================
# Copyright (c) 2013,2014 Hajo Eichler
# Licensed under the MIT license.
*/
var Logger, StockImport, bunyanLogentries, package_json;

package_json = require('../package.json');

Logger = require('./logger');

StockImport = require('./stockimport');

bunyanLogentries = require('bunyan-logentries');

exports.process = function(msg, cfg, next, snapshot) {
  var logStreams, logger, opts, stockimport;
  logStreams = [
    {
      level: 'warn',
      stream: process.stderr
    }
  ];
  if (cfg.logentriesToken != null) {
    logStreams.push({
      level: 'info',
      stream: bunyanLogentries.createStream({
        token: cfg.logentriesToken
      }),
      type: 'raw'
    });
  }
  logger = new Logger({
    streams: logStreams
  });
  opts = {
    config: {
      client_id: cfg.sphereClientId,
      client_secret: cfg.sphereClientSecret,
      project_key: cfg.sphereProjectKey
    },
    timeout: 60000,
    user_agent: "" + package_json.name + " - elasticio - " + package_json.version,
    logConfig: {
      logger: logger
    }
  };
  stockimport = new StockImport(opts);
  return stockimport.elasticio(msg, cfg, next, snapshot);
};
