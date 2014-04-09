/* ===========================================================
# sphere-stock-xml-import - v0.3.8
# ==============================================================
# Copyright (c) 2013,2014 Hajo Eichler
# Licensed under the MIT license.
*/
var CHANNEL_KEY_FOR_XML_MAPPING, CHANNEL_REF_NAME, CHANNEL_ROLES, Csv, ElasticIo, InventorySync, LOG_PREFIX, Q, StockImport, package_json, xmlHelpers, _;

Q = require('q');

_ = require('underscore');

Csv = require('csv');

ElasticIo = require('sphere-node-utils').ElasticIo;

InventorySync = require('sphere-node-sync').InventorySync;

package_json = require('../package.json');

xmlHelpers = require('./xmlhelpers');

CHANNEL_KEY_FOR_XML_MAPPING = 'expectedStock';

CHANNEL_REF_NAME = 'supplyChannel';

CHANNEL_ROLES = ['InventorySupply', 'OrderExport', 'OrderImport'];

LOG_PREFIX = "[SphereStockImport] ";

StockImport = (function() {
  function StockImport(options) {
    var logConfig;
    if (options == null) {
      options = {};
    }
    logConfig = options.logConfig;
    this.logger = logConfig.logger;
    this.sync = new InventorySync(options);
    this.client = this.sync._client;
    this.existingInventoryEntries = {};
  }

  StockImport.prototype.getMode = function(fileName) {
    switch (false) {
      case !fileName.match(/\.csv$/i):
        return 'CSV';
      case !fileName.match(/\.xml$/i):
        return 'XML';
      default:
        throw new Error("Unsupported mode (file extension) for file " + fileName + " (use csv or xml)");
    }
  };

  StockImport.prototype.elasticio = function(msg, cfg, next, snapshot) {
    var attachment, content, encoded, mode, _results;
    this.logger.debug(msg, 'Running elastic.io');
    if (_.size(msg.attachments) > 0) {
      _results = [];
      for (attachment in msg.attachments) {
        content = msg.attachments[attachment].content;
        if (!content) {
          continue;
        }
        encoded = new Buffer(content, 'base64').toString();
        mode = this.getMode(attachment);
        _results.push(this.run(encoded, mode, next).then((function(_this) {
          return function(result) {
            return ElasticIo.returnSuccess(_this.sumResult(result), next);
          };
        })(this)).fail(function(err) {
          return ElasticIo.returnFailure(err, next);
        }).done());
      }
      return _results;
    } else if (_.size(msg.body) > 0) {
      return this._initMatcher("sku=\"" + msg.body.SKU + "\"").then((function(_this) {
        return function() {
          if (msg.body.CHANNEL_KEY != null) {
            return _this.ensureChannelByKey(_this.client._rest, msg.body.CHANNEL_KEY, CHANNEL_ROLES).then(function(result) {
              return _this._createOrUpdate([_this.createInventoryEntry(msg.body.SKU, msg.body.QUANTITY, msg.body.EXPECTED_DELIVERY, result.id)]);
            }).then(function(result) {
              return ElasticIo.returnSuccess(_this.sumResult(result), next);
            });
          } else {
            return _this._createOrUpdate([_this.createInventoryEntry(msg.body.SKU, msg.body.QUANTITY, msg.body.EXPECTED_DELIVERY, msg.body.CHANNEL_ID)]).then(function(result) {
              return ElasticIo.returnSuccess(_this.sumResult(result), next);
            });
          }
        };
      })(this)).fail(function(err) {
        return ElasticIo.returnFailure(err, next);
      }).done();
    } else {
      return ElasticIo.returnFailure("" + LOG_PREFIX + "No data found in elastic.io msg.", next);
    }
  };

  StockImport.prototype.ensureChannelByKey = function(rest, channelKey, channelRolesForCreation) {
    var deferred, query;
    deferred = Q.defer();
    query = encodeURIComponent("key=\"" + channelKey + "\"");
    rest.GET("/channels?where=" + query, function(error, response, body) {
      var channel, channels, humanReadable;
      if (error != null) {
        return deferred.reject("Error on getting channel: " + error);
      } else if (response.statusCode !== 200) {
        humanReadable = JSON.stringify(body, null, 2);
        return deferred.reject("" + LOG_PREFIX + "Problem on getting channel: " + humanReadable);
      } else {
        channels = body.results;
        if (_.size(channels) === 1) {
          return deferred.resolve(channels[0]);
        } else {
          channel = {
            key: channelKey,
            roles: channelRolesForCreation
          };
          return rest.POST('/channels', channel, function(error, response, body) {
            if (error != null) {
              return deferred.reject("" + LOG_PREFIX + "Error on creating channel: " + error);
            } else if (response.statusCode === 201) {
              return deferred.resolve(body);
            } else {
              humanReadable = JSON.stringify(body, null, 2);
              return deferred.reject("" + LOG_PREFIX + "Problem on creating channel: " + humanReadable);
            }
          });
        }
      }
    });
    return deferred.promise;
  };

  StockImport.prototype.run = function(fileContent, mode, next) {
    if (mode === 'XML') {
      return this.performXML(fileContent, next);
    } else if (mode === 'CSV') {
      return this.performCSV(fileContent, next);
    } else {
      return Q.reject("" + LOG_PREFIX + "Unknown import mode '" + mode + "'!");
    }
  };

  StockImport.prototype.sumResult = function(result) {
    var nums, res;
    if (_.isArray(result)) {
      if (_.isEmpty(result)) {
        return 'Nothing done.';
      } else {
        nums = _.reduce(result, (function(memo, r) {
          switch (r.statusCode) {
            case 201:
              memo[0] = memo[0] + 1;
              break;
            case 200:
              memo[1] = memo[1] + 1;
              break;
            case 304:
              memo[2] = memo[2] + 1;
          }
          return memo;
        }), [0, 0, 0]);
        return res = {
          'Inventory entry created.': nums[0],
          'Inventory entry updated.': nums[1],
          'Inventory update was not necessary.': nums[2]
        };
      }
    } else {
      return result;
    }
  };

  StockImport.prototype.performCSV = function(fileContent, next) {
    var deferred;
    deferred = Q.defer();
    Csv().from.string(fileContent).to.array((function(_this) {
      return function(data, count) {
        var header, stocks;
        header = data[0];
        stocks = _this._mapStockFromCSV(_.rest(data));
        return _this._perform(stocks, next).then(function(result) {
          return deferred.resolve(result);
        }).fail(function(err) {
          return deferred.reject(err);
        }).done();
      };
    })(this)).on('error', function(error) {
      return deferred.reject("" + LOG_PREFIX + "Problem in parsing CSV: " + error);
    });
    return deferred.promise;
  };

  StockImport.prototype._mapStockFromCSV = function(rows, skuIndex, quantityIndex) {
    if (skuIndex == null) {
      skuIndex = 0;
    }
    if (quantityIndex == null) {
      quantityIndex = 1;
    }
    return _.map(rows, (function(_this) {
      return function(row) {
        var quantity, sku;
        sku = row[skuIndex];
        quantity = row[quantityIndex];
        return _this.createInventoryEntry(sku, quantity);
      };
    })(this));
  };

  StockImport.prototype.performXML = function(fileContent, next) {
    var deferred;
    deferred = Q.defer();
    xmlHelpers.xmlTransform(xmlHelpers.xmlFix(fileContent), (function(_this) {
      return function(err, xml) {
        if (err != null) {
          return deferred.reject("" + LOG_PREFIX + "Error on parsing XML: " + err);
        } else {
          return _this.ensureChannelByKey(_this.client._rest, CHANNEL_KEY_FOR_XML_MAPPING, CHANNEL_ROLES).then(function(result) {
            var stocks;
            stocks = _this._mapStockFromXML(xml.root, result.id);
            return _this._perform(stocks, next).then(function(result) {
              return deferred.resolve(result);
            });
          }).fail(function(err) {
            return deferred.reject(err);
          }).done();
        }
      };
    })(this));
    return deferred.promise;
  };

  StockImport.prototype._mapStockFromXML = function(xmljs, channelId) {
    var stocks;
    stocks = [];
    if (xmljs.row != null) {
      _.each(xmljs.row, (function(_this) {
        return function(row) {
          var appointedQuantity, d, expectedDelivery, sku;
          sku = xmlHelpers.xmlVal(row, 'code');
          stocks.push(_this.createInventoryEntry(sku, xmlHelpers.xmlVal(row, 'quantity')));
          appointedQuantity = xmlHelpers.xmlVal(row, 'AppointedQuantity');
          if (appointedQuantity != null) {
            expectedDelivery = xmlHelpers.xmlVal(row, 'CommittedDeliveryDate');
            if (expectedDelivery != null) {
              expectedDelivery = new Date(expectedDelivery).toISOString();
            }
            d = _this.createInventoryEntry(sku, appointedQuantity, expectedDelivery, channelId);
            return stocks.push(d);
          }
        };
      })(this));
    }
    return stocks;
  };

  StockImport.prototype.createInventoryEntry = function(sku, quantity, expectedDelivery, channelId) {
    var entry;
    entry = {
      sku: sku,
      quantityOnStock: parseInt(quantity)
    };
    if (expectedDelivery != null) {
      entry.expectedDelivery = expectedDelivery;
    }
    if (channelId != null) {
      entry[CHANNEL_REF_NAME] = {
        typeId: 'channel',
        id: channelId
      };
    }
    return entry;
  };

  StockImport.prototype._perform = function(stocks, next) {
    this.logger.info("Stock entries to process: " + (_.size(stocks)));
    if (_.isFunction(next)) {
      _.each(stocks, function(entry) {
        var msg;
        msg = {
          body: {
            SKU: entry.sku,
            QUANTITY: entry.quantityOnStock
          }
        };
        if (entry.expectedDelivery != null) {
          msg.body.EXPECTED_DELIVERY = entry.expectedDelivery;
        }
        if (entry[CHANNEL_REF_NAME] != null) {
          msg.body.CHANNEL_ID = entry[CHANNEL_REF_NAME].id;
        }
        return ElasticIo.returnSuccess(msg, next);
      });
      return Q("" + LOG_PREFIX + "elastic.io messages sent.");
    } else {
      return this._initMatcher().then((function(_this) {
        return function() {
          return _this._createOrUpdate(stocks);
        };
      })(this));
    }
  };

  StockImport.prototype._initMatcher = function(where) {
    var req;
    req = this.client.inventoryEntries;
    if (where != null) {
      req = req.where(where).perPage(1);
    } else {
      req = req.perPage(0);
    }
    return req.fetch().then((function(_this) {
      return function(result) {
        _this.existingInventoryEntries = result.body.results;
        _this.logger.info("Existing entries: " + (_.size(_this.existingInventoryEntries)));
        return Q('#{LOG_PREFIX}matcher initialized');
      };
    })(this));
  };

  StockImport.prototype._match = function(entry) {
    return _.find(this.existingInventoryEntries, function(existingEntry) {
      if (existingEntry.sku === entry.sku) {
        if (_.has(existingEntry, CHANNEL_REF_NAME) && _.has(entry, CHANNEL_REF_NAME)) {
          return existingEntry[CHANNEL_REF_NAME].id === entry[CHANNEL_REF_NAME].id;
        } else {
          return !_.has(entry, CHANNEL_REF_NAME);
        }
      }
    });
  };

  StockImport.prototype._createOrUpdate = function(inventoryEntries) {
    var posts;
    posts = _.map(inventoryEntries, (function(_this) {
      return function(entry) {
        var existingEntry;
        existingEntry = _this._match(entry);
        if (existingEntry != null) {
          return _this.sync.buildActions(entry, existingEntry).update();
        } else {
          return _this.client.inventoryEntries.create(entry);
        }
      };
    })(this));
    this.logger.info("Requests: " + (_.size(posts)));
    return Q.all(posts);
  };

  return StockImport;

})();

module.exports = StockImport;
