/* ===========================================================
# sphere-stock-import - v0.5.11
# ==============================================================
# Copyright (c) 2013,2014 Hajo Eichler
# Licensed under the MIT license.
*/
var Q, Sftp, fs, _;

fs = require('q-io/fs');

_ = require('underscore');

Q = require('q');

Sftp = require('sphere-node-utils').Sftp;

module.exports = (function() {

  /**
   * @constructor
   * Initialize {Sftp} client
   * @param {Object} [options] Configuration for {Sftp}
   */
  function _Class(options) {
    var host, password, username;
    if (options == null) {
      options = {};
    }
    host = options.host, username = options.username, password = options.password, this.sourceFolder = options.sourceFolder, this.targetFolder = options.targetFolder, this.fileRegex = options.fileRegex, this.logger = options.logger;
    this.sftpClient = new Sftp({
      host: host,
      username: username,
      password: password,
      logger: this.logger
    });
  }

  _Class.prototype.download = function(tmpFolder) {
    var d;
    d = Q.defer();
    fs.exists(tmpFolder).then((function(_this) {
      return function(exists) {
        if (exists) {
          return Q();
        } else {
          _this.logger.debug('Creating new tmp folder');
          return fs.makeDirectory(tmpFolder);
        }
      };
    })(this)).then((function(_this) {
      return function() {
        return _this.sftpClient.openSftp();
      };
    })(this)).then((function(_this) {
      return function(sftp) {
        _this.logger.debug('New connection opened');
        _this._sftp = sftp;
        return _this.sftpClient.downloadAllFiles(sftp, tmpFolder, _this.sourceFolder, _this.fileRegex);
      };
    })(this)).then(function() {
      return fs.list(tmpFolder);
    }).then(function(files) {
      return d.resolve(_.filter(files, function(fileName) {
        switch (false) {
          case !fileName.match(/\.csv$/i):
            return true;
          case !fileName.match(/\.xml$/i):
            return true;
          default:
            return false;
        }
      }));
    }).fail(function(error) {
      return d.reject(error);
    }).fin((function(_this) {
      return function() {
        _this.logger.debug('Closing connection');
        return _this.sftpClient.close(_this._sftp);
      };
    })(this));
    return d.promise;
  };

  _Class.prototype.finish = function(fileName) {
    var d;
    d = Q.defer();
    this.sftpClient.openSftp().then((function(_this) {
      return function(sftp) {
        _this.logger.debug('New connection opened');
        _this._sftp = sftp;
        _this.logger.debug("Renaming file " + fileName + " on the remote server");
        return _this.sftpClient.safeRenameFile(sftp, "" + _this.sourceFolder + "/" + fileName, "" + _this.targetFolder + "/" + fileName);
      };
    })(this)).then(function() {
      return d.resolve();
    }).fail(function(error) {
      return d.reject(error);
    }).fin((function(_this) {
      return function() {
        _this.logger.debug('Closing connection');
        return _this.sftpClient.close(_this._sftp);
      };
    })(this));
    return d.promise;
  };

  return _Class;

})();
