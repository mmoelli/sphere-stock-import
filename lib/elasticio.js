/* ===========================================================
# sphere-stock-import - v0.5.11
# ==============================================================
# Copyright (c) 2013,2014 Hajo Eichler
# Licensed under the MIT license.
*/
var ExtendedLogger, StockImport, bunyanLogentries, package_json;

ExtendedLogger = require('sphere-node-utils').ExtendedLogger;

bunyanLogentries = require('bunyan-logentries');

package_json = require('../package.json');

StockImport = require('./stockimport');

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
  logger = new ExtendedLogger({
    additionalFields: {
      project_key: cfg.sphereProjectKey
    },
    logConfig: {
      name: "" + package_json.name + "-" + package_json.version,
      streams: logStreams
    }
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
      logger: logger.bunyanLogger
    },
    csvHeaders: 'sku, quantity',
    csvDelimiter: ','
  };
  stockimport = new StockImport(logger, opts);
  return stockimport.elasticio(msg, cfg, next, snapshot);
};
