/* ===========================================================
# sphere-stock-import - v0.5.11
# ==============================================================
# Copyright (c) 2013,2014 Hajo Eichler
# Licensed under the MIT license.
*/
var ExtendedLogger, ProjectCredentialsConfig, Q, Qutils, SftpHelper, StockImport, argv, createTmpDir, fs, importFn, logOptions, logger, package_json, path, readJsonFromPath, tmp, _, _ref;

fs = require('q-io/fs');

Q = require('q');

_ = require('underscore');

path = require('path');

tmp = require('tmp');

_ref = require('sphere-node-utils'), ExtendedLogger = _ref.ExtendedLogger, ProjectCredentialsConfig = _ref.ProjectCredentialsConfig, Qutils = _ref.Qutils;

package_json = require('../package.json');

StockImport = require('./stockimport');

SftpHelper = require('./sftp');

argv = require('optimist').usage('Usage: $0 --projectKey [key] --clientId [id] --clientSecret [secret] --file [file] --logDir [dir] --logLevel [level]').describe('projectKey', 'your SPHERE.IO project-key').describe('clientId', 'your OAuth client id for the SPHERE.IO API').describe('clientSecret', 'your OAuth client secret for the SPHERE.IO API').describe('sphereHost', 'SPHERE.IO API host to connecto to').describe('file', 'XML or CSV file containing inventory information to import').describe('csvHeaders', 'a list of column names to use as mapping, comma separated').describe('csvDelimiter', 'the delimiter type used in the csv').describe('sftpCredentials', 'the path to a JSON file where to read the credentials from').describe('sftpHost', 'the SFTP host (overwrite value in sftpCredentials JSON, if given)').describe('sftpUsername', 'the SFTP username (overwrite value in sftpCredentials JSON, if given)').describe('sftpPassword', 'the SFTP password (overwrite value in sftpCredentials JSON, if given)').describe('sftpSource', 'path in the SFTP server from where to read the files').describe('sftpTarget', 'path in the SFTP server to where to move the worked files').describe('sftpFileRegex', 'a RegEx to filter files when downloading them').describe('logLevel', 'log level for file logging').describe('logDir', 'directory to store logs').describe('logSilent', 'use console to print messages').describe('timeout', 'Set timeout for requests')["default"]('csvHeaders', 'sku, quantity')["default"]('csvDelimiter', ',')["default"]('logLevel', 'info')["default"]('logDir', '.')["default"]('logSilent', false)["default"]('timeout', 60000).demand(['projectKey']).argv;

logOptions = {
  name: "" + package_json.name + "-" + package_json.version,
  streams: [
    {
      level: 'error',
      stream: process.stderr
    }, {
      level: argv.logLevel,
      path: "" + argv.logDir + "/" + package_json.name + ".log"
    }
  ]
};

if (argv.logSilent) {
  logOptions.silent = argv.logSilent;
}

logger = new ExtendedLogger({
  additionalFields: {
    project_key: argv.projectKey
  },
  logConfig: logOptions
});

if (argv.logSilent) {
  logger.bunyanLogger.trace = function() {};
  logger.bunyanLogger.debug = function() {};
}

process.on('SIGUSR2', function() {
  return logger.reopenFileStreams();
});

process.on('exit', (function(_this) {
  return function() {
    return process.exit(_this.exitCode);
  };
})(this));

importFn = function(importer, fileName) {
  var d, mode;
  if (!fileName) {
    throw new Error('You must provide a file to be processed');
  }
  d = Q.defer();
  logger.debug("About to process file " + fileName);
  mode = importer.getMode(fileName);
  fs.read(fileName).then(function(content) {
    logger.debug('File read, running import');
    return importer.run(content, mode).then(function() {
      return importer.summaryReport(fileName);
    }).then(function(message) {
      logger.withField({
        filename: fileName
      }).info(message);
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


/**
 * Simple temporary directory creation, it will be removed on process exit.
 */

createTmpDir = function() {
  var d;
  d = Q.defer();
  tmp.dir({
    unsafeCleanup: true
  }, function(err, path) {
    if (err) {
      return d.reject(err);
    } else {
      return d.resolve(path);
    }
  });
  return d.promise;
};

readJsonFromPath = function(path) {
  if (!path) {
    return Q({});
  }
  return fs.read(path).then(function(content) {
    return Q(JSON.parse(content));
  });
};

ProjectCredentialsConfig.create().then((function(_this) {
  return function(credentials) {
    var file, options, stockimport;
    options = {
      config: credentials.enrichCredentials({
        project_key: argv.projectKey,
        client_id: argv.clientId,
        client_secret: argv.clientSecret
      }),
      timeout: argv.timeout,
      user_agent: "" + package_json.name + " - " + package_json.version,
      logConfig: {
        logger: logger.bunyanLogger
      },
      csvHeaders: argv.csvHeaders,
      csvDelimiter: argv.csvDelimiter
    };
    if (argv.sphereHost) {
      options.host = argv.sphereHost;
    }
    stockimport = new StockImport(logger, options);
    file = argv.file;
    if (file) {
      return importFn(stockimport, file).then(function() {
        return _this.exitCode = 0;
      }).fail(function(code) {
        return _this.exitCode = code;
      }).done();
    } else {
      tmp.setGracefulCleanup();
      return readJsonFromPath(argv.sftpCredentials).then(function(sftpCredentials) {
        var host, password, projectSftpCredentials, sftpHelper, username, _ref1;
        projectSftpCredentials = sftpCredentials[argv.projectKey] || {};
        _ref1 = _.defaults(projectSftpCredentials, {
          host: argv.sftpHost,
          username: argv.sftpUsername,
          password: argv.sftpPassword
        }), host = _ref1.host, username = _ref1.username, password = _ref1.password;
        if (!host) {
          throw new Error('Missing sftp host');
        }
        if (!username) {
          throw new Error('Missing sftp username');
        }
        if (!password) {
          throw new Error('Missing sftp password');
        }
        sftpHelper = new SftpHelper({
          host: host,
          username: username,
          password: password,
          sourceFolder: argv.sftpSource,
          targetFolder: argv.sftpTarget,
          fileRegex: argv.sftpFileRegex,
          logger: logger
        });
        return createTmpDir().then(function(tmpPath) {
          logger.debug("Tmp folder created at " + tmpPath);
          return sftpHelper.download(tmpPath).then(function(files) {
            logger.debug(files, "Processing " + files.length + " files...");
            return Qutils.processList(files, function(fileParts) {
              if (fileParts.length !== 1) {
                throw new Error('Files should be processed once at a time');
              }
              file = fileParts[0];
              return importFn(stockimport, "" + tmpPath + "/" + file).then(function() {
                logger.debug("Finishing processing file " + file);
                return sftpHelper.finish(file);
              });
            }, {
              accumulate: false
            });
          }).then(function() {
            logger.info('Processing files to SFTP complete');
            return _this.exitCode = 0;
          });
        }).fail(function(error) {
          logger.error(error, 'Oops, something went wrong!');
          return _this.exitCode = 1;
        }).done();
      }).fail(function(err) {
        logger.error(err, "Problems on getting sftp credentials from config files.");
        return _this.exitCode = 1;
      }).done();
    }
  };
})(this)).fail((function(_this) {
  return function(err) {
    logger.error(err, "Problems on getting client credentials from config files.");
    return _this.exitCode = 1;
  };
})(this)).done();
