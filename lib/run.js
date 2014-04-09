/* ===========================================================
# sphere-stock-xml-import - v0.3.8
# ==============================================================
# Copyright (c) 2013,2014 Hajo Eichler
# Licensed under the MIT license.
*/
var Logger, ProjectCredentialsConfig, Q, SftpHelper, StockImport, argv, credentialsConfig, fs, importFn, logger, package_json, path, processFn, _;

fs = require('q-io/fs');

Q = require('q');

_ = require('underscore');

path = require('path');

ProjectCredentialsConfig = require('sphere-node-utils').ProjectCredentialsConfig;

package_json = require('../package.json');

Logger = require('./logger');

StockImport = require('./stockimport');

SftpHelper = require('./sftp');

argv = require('optimist').usage('Usage: $0 --projectKey [key] --clientId [id] --clientSecret [secret] --file [file] --logDir [dir] --logLevel [level]').describe('projectKey', 'your SPHERE.IO project-key').describe('clientId', 'your OAuth client id for the SPHERE.IO API').describe('clientSecret', 'your OAuth client secret for the SPHERE.IO API').describe('file', 'XML or CSV file containing inventory information to import').describe('sftpHost', 'the SFTP host').describe('sftpUsername', 'the SFTP username').describe('sftpPassword', 'the SFTP password').describe('sftpSource', 'path in the SFTP server from where to read the files').describe('sftpTarget', 'path in the SFTP server to where to move the worked files').describe('logLevel', 'log level for file logging').describe('logDir', 'directory to store logs').describe('timeout', 'Set timeout for requests')["default"]('logLevel', 'info')["default"]('logDir', '.')["default"]('timeout', 60000).demand(['projectKey']).argv;

logger = new Logger({
  streams: [
    {
      level: 'error',
      stream: process.stderr
    }, {
      level: argv.logLevel,
      path: "" + argv.logDir + "/sphere-stock-xml-import_" + argv.projectKey + ".log"
    }
  ]
});

process.on('SIGUSR2', function() {
  return logger.reopenFileStreams();
});

importFn = function(fileName) {
  var d, mode;
  if (!fileName) {
    throw new Error('You must provide a file to be processed');
  }
  d = Q.defer();
  logger.info("About to process file " + fileName);
  mode = stockimport.getMode(fileName);
  fs.read(fileName).then(function(content) {
    logger.info('File read, running import');
    return stockimport.run(content, mode).then(function(result) {
      logger.info(stockimport.sumResult(result));
      return d.resolve(fileName);
    }).fail(function(e) {
      logger.error(e, "Oops, something went wrong when processing file " + fileName);
      return d.reject(1);
    });
  }).fail(function(e) {
    logger.error(e, "Cannot read file " + fileName);
    return d.reject(2);
  });
  return d.promise;
};

processFn = function(files, fn) {
  var d, _process;
  if (!_.isFunction(fn)) {
    throw new Error('Please provide a function to process the files');
  }
  d = Q.defer();
  _process = function(tick) {
    var file;
    logger.info(tick, 'Current tick');
    if (tick >= files.length) {
      logger.info('No more files, resolving...');
      return d.resolve();
    } else {
      file = files[tick];
      return fn(file).then(function() {
        logger.info("Finishing processing file " + file);
        return sftpHelper.finish(file);
      }).then(function() {
        return _process(tick + 1);
      }).fail(function(error) {
        return d.reject(error);
      }).done();
    }
  };
  _process(0);
  return d.promise;
};

credentialsConfig = ProjectCredentialsConfig.create().then(function(credentials) {
  var TMP_PATH, file, options, sftpHelper, stockimport;
  options = {
    config: credentials.enrichCredentials({
      project_key: argv.projectKey,
      client_id: argv.clientId,
      client_secret: argv.clientSecret
    }),
    timeout: argv.timeout,
    user_agent: "" + package_json.name + " - " + package_json.version,
    logConfig: {
      logger: logger
    }
  };
  stockimport = new StockImport(options);
  file = argv.file;
  if (file) {
    return importFn(file).then(function() {
      return process.exit(0);
    }).fail(function(code) {
      return process.exit(code);
    }).done();
  } else {
    TMP_PATH = path.join(__dirname, '../tmp');
    sftpHelper = new SftpHelper({
      host: argv.sftpHost,
      username: argv.sftpUsername,
      password: argv.sftpPassword,
      sourceFolder: argv.sftpSource,
      targetFolder: argv.sftpTarget,
      logger: logger
    });
    return sftpHelper.download(TMP_PATH).then(function(files) {
      logger.info(files, "Processing " + files.length + " files...");
      return processFn(files, function(file) {
        return importFn("" + TMP_PATH + "/" + file);
      });
    }).then(function() {
      logger.info('Cleaning tmp folder');
      return sftpHelper.cleanup(TMP_PATH);
    }).then(function() {
      return process.exit(0);
    }).fail(function(error) {
      logger.error(error, 'Oops, something went wrong!');
      return process.exit(1);
    }).done();
  }
}).fail(function(err) {
  logger.error(e, "Problems on getting client credentials from config files.");
  return process.exit(1);
}).done();
