/* ===========================================================
# sphere-stock-import - v0.5.11
# ==============================================================
# Copyright (c) 2013,2014 Hajo Eichler
# Licensed under the MIT license.
*/
var CHANNEL_KEY_FOR_XML_MAPPING, CHANNEL_REF_NAME, CHANNEL_ROLES, Csv, ElasticIo, InventorySync, LOG_PREFIX, Q, Qutils, SphereClient, StockImport, package_json, xmlHelpers, _, _ref;

Q = require('q');

_ = require('underscore');

Csv = require('csv');

_ref = require('sphere-node-utils'), ElasticIo = _ref.ElasticIo, Qutils = _ref.Qutils;

InventorySync = require('sphere-node-sync').InventorySync;

SphereClient = require('sphere-node-client');

package_json = require('../package.json');

xmlHelpers = require('./xmlhelpers');

CHANNEL_KEY_FOR_XML_MAPPING = 'expectedStock';

CHANNEL_REF_NAME = 'supplyChannel';

CHANNEL_ROLES = ['InventorySupply', 'OrderExport', 'OrderImport'];

LOG_PREFIX = "[SphereStockImport] ";

StockImport = (function() {
  function StockImport(logger, options) {
    this.logger = logger;
    if (options == null) {
      options = {};
    }
    this.sync = new InventorySync(options);
    this.client = new SphereClient(options);
    this.csvHeaders = options.csvHeaders;
    this.csvDelimiter = options.csvDelimiter;
    this._resetSummary();
  }

  StockImport.prototype._resetSummary = function() {
    return this.summary = {
      emptySKU: 0,
      created: 0,
      updated: 0
    };
  };

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


  /*
  Elastic.io calls this for each csv row, so each inventory entry will be processed at a time
   */

  StockImport.prototype.elasticio = function(msg, cfg, next, snapshot) {
    var attachment, content, encoded, mode, _ensureChannel, _results;
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
            if (result) {
              return ElasticIo.returnSuccess(result, next);
            } else {
              return _this.summaryReport().then(function(message) {
                return ElasticIo.returnSuccess(message, next);
              });
            }
          };
        })(this)).fail(function(err) {
          return ElasticIo.returnFailure(err, next);
        }).done());
      }
      return _results;
    } else if (_.size(msg.body) > 0) {
      _ensureChannel = (function(_this) {
        return function() {
          if (msg.body.CHANNEL_KEY != null) {
            return _this.client.channels.ensure(msg.body.CHANNEL_KEY, CHANNEL_ROLES).then(function(result) {
              _this.logger.debug(result, 'Channel ensured, about to create or update');
              return Q(result.body.id);
            });
          } else {
            return Q(msg.body.CHANNEL_ID);
          }
        };
      })(this);
      return this.client.inventoryEntries.where("sku=\"" + msg.body.SKU + "\"").perPage(1).fetch().then((function(_this) {
        return function(results) {
          var existingEntries;
          _this.logger.debug(results, 'Existing entries');
          existingEntries = results.body.results;
          return _ensureChannel().then(function(channelId) {
            var stocksToProcess;
            stocksToProcess = [_this._createInventoryEntry(msg.body.SKU, msg.body.QUANTITY, msg.body.EXPECTED_DELIVERY, channelId)];
            return _this._createOrUpdate(stocksToProcess, existingEntries);
          }).then(function(results) {
            _.each(results, function(r) {
              switch (r.statusCode) {
                case 201:
                  return _this.summary.created++;
                case 200:
                  return _this.summary.updated++;
              }
            });
            return _this.summaryReport();
          }).then(function(message) {
            return ElasticIo.returnSuccess(message, next);
          });
        };
      })(this)).fail((function(_this) {
        return function(err) {
          _this.logger.debug(err, 'Failed to process inventory');
          return ElasticIo.returnFailure(err, next);
        };
      })(this)).done();
    } else {
      return ElasticIo.returnFailure("" + LOG_PREFIX + "No data found in elastic.io msg.", next);
    }
  };

  StockImport.prototype.run = function(fileContent, mode, next) {
    this._resetSummary();
    if (mode === 'XML') {
      return this.performXML(fileContent, next);
    } else if (mode === 'CSV') {
      return this.performCSV(fileContent, next);
    } else {
      return Q.reject("" + LOG_PREFIX + "Unknown import mode '" + mode + "'!");
    }
  };

  StockImport.prototype.summaryReport = function(filename) {
    var message, warning;
    if (this.summary.created === 0 && this.summary.updated === 0) {
      message = 'Summary: nothing to do, everything is fine';
    } else {
      message = ("Summary: there were " + (this.summary.created + this.summary.updated) + " imported stocks ") + ("(" + this.summary.created + " were new and " + this.summary.updated + " were updates)");
    }
    if (this.summary.emptySKU > 0) {
      warning = "Found " + this.summary.emptySKU + " empty SKUs from file input";
      if (filename) {
        warning += " '" + filename + "'";
      }
      this.logger.warn(warning);
    }
    return Q(message);
  };

  StockImport.prototype.performXML = function(fileContent, next) {
    var deferred;
    deferred = Q.defer();
    xmlHelpers.xmlTransform(xmlHelpers.xmlFix(fileContent), (function(_this) {
      return function(err, xml) {
        if (err != null) {
          return deferred.reject("" + LOG_PREFIX + "Error on parsing XML: " + err);
        } else {
          return _this.client.channels.ensure(CHANNEL_KEY_FOR_XML_MAPPING, CHANNEL_ROLES).then(function(result) {
            var stocks;
            stocks = _this._mapStockFromXML(xml.root, result.body.id);
            return _this._perform(stocks, next);
          }).then(function(result) {
            return deferred.resolve(result);
          }).fail(function(err) {
            return deferred.reject(err);
          }).done();
        }
      };
    })(this));
    return deferred.promise;
  };

  StockImport.prototype.performCSV = function(fileContent, next) {
    var deferred;
    deferred = Q.defer();
    Csv().from.string(fileContent, {
      delimiter: this.csvDelimiter,
      trim: true
    }).to.array((function(_this) {
      return function(data, count) {
        var headers;
        headers = data[0];
        return _this._getHeaderIndexes(headers, _this.csvHeaders).then(function(mappedHeaderIndexes) {
          var stocks;
          stocks = _this._mapStockFromCSV(_.tail(data), mappedHeaderIndexes[0], mappedHeaderIndexes[1]);
          _this.logger.debug(stocks, "Stock mapped from csv for headers " + mappedHeaderIndexes);
          return _this._perform(stocks, next).then(function(result) {
            return deferred.resolve(result);
          });
        }).fail(function(err) {
          return deferred.reject(err);
        }).done();
      };
    })(this)).on('error', function(error) {
      return deferred.reject("" + LOG_PREFIX + "Problem in parsing CSV: " + error);
    });
    return deferred.promise;
  };

  StockImport.prototype._getHeaderIndexes = function(headers, csvHeaders) {
    return Q.all(_.map(csvHeaders.split(','), (function(_this) {
      return function(h) {
        var cleanHeader, headerIndex, mappedHeader;
        cleanHeader = h.trim();
        mappedHeader = _.find(headers, function(header) {
          return header.toLowerCase() === cleanHeader.toLowerCase();
        });
        if (!mappedHeader) {
          return Q.reject("Can't find header '" + cleanHeader + "' in '" + headers + "'.");
        }
        headerIndex = _.indexOf(headers, mappedHeader);
        _this.logger.debug(headers, "Found index " + headerIndex + " for header " + cleanHeader);
        return Q(headerIndex);
      };
    })(this)));
  };

  StockImport.prototype._mapStockFromXML = function(xmljs, channelId) {
    var stocks;
    stocks = [];
    if (xmljs.row != null) {
      _.each(xmljs.row, (function(_this) {
        return function(row) {
          var appointedQuantity, committedDeliveryDate, d, expectedDelivery, sku;
          sku = xmlHelpers.xmlVal(row, 'code');
          stocks.push(_this._createInventoryEntry(sku, xmlHelpers.xmlVal(row, 'quantity')));
          appointedQuantity = xmlHelpers.xmlVal(row, 'AppointedQuantity');
          if (appointedQuantity != null) {
            expectedDelivery = void 0;
            committedDeliveryDate = xmlHelpers.xmlVal(row, 'CommittedDeliveryDate');
            if (committedDeliveryDate) {
              expectedDelivery = new Date(committedDeliveryDate).toISOString();
            }
            d = _this._createInventoryEntry(sku, appointedQuantity, expectedDelivery, channelId);
            return stocks.push(d);
          }
        };
      })(this));
    }
    return stocks;
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
        var quantity, sku, _ref1;
        sku = row[skuIndex].trim();
        quantity = (_ref1 = row[quantityIndex]) != null ? _ref1.trim() : void 0;
        return _this._createInventoryEntry(sku, quantity);
      };
    })(this));
  };

  StockImport.prototype._createInventoryEntry = function(sku, quantity, expectedDelivery, channelId) {
    var entry;
    entry = {
      sku: sku,
      quantityOnStock: parseInt(quantity) || 0
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
      return Qutils.processList(stocks, (function(_this) {
        return function(stocksToProcess) {
          var ie;
          ie = _this.client.inventoryEntries.perPage(0).whereOperator('or');
          _this.logger.debug(stocksToProcess, 'Stocks to process');
          _.each(stocksToProcess, function(s) {
            if (_.isEmpty(s.sku)) {
              _this.summary.emptySKU++;
            }
            return ie.where("sku = \"" + s.sku + "\"");
          });
          return ie.fetch().then(function(results) {
            var queriedEntries;
            _this.logger.debug(results, 'Fetched stocks');
            queriedEntries = results.body.results;
            return _this._createOrUpdate(stocksToProcess, queriedEntries);
          }).then(function(results) {
            _.each(results, function(r) {
              switch (r.statusCode) {
                case 201:
                  return _this.summary.created++;
                case 200:
                  return _this.summary.updated++;
              }
            });
            return Q();
          });
        };
      })(this), {
        maxParallel: 50,
        accumulate: false
      });
    }
  };

  StockImport.prototype._match = function(entry, existingEntries) {
    return _.find(existingEntries, function(existingEntry) {
      if (existingEntry.sku === entry.sku) {
        if (_.has(existingEntry, CHANNEL_REF_NAME) && _.has(entry, CHANNEL_REF_NAME)) {
          return existingEntry[CHANNEL_REF_NAME].id === entry[CHANNEL_REF_NAME].id;
        } else {
          return !_.has(entry, CHANNEL_REF_NAME);
        }
      }
    });
  };

  StockImport.prototype._createOrUpdate = function(inventoryEntries, existingEntries) {
    var posts;
    this.logger.debug(inventoryEntries, 'Inventory entries');
    posts = _.map(inventoryEntries, (function(_this) {
      return function(entry) {
        var existingEntry;
        existingEntry = _this._match(entry, existingEntries);
        if (existingEntry != null) {
          return _this.sync.buildActions(entry, existingEntry).update();
        } else {
          return _this.client.inventoryEntries.create(entry);
        }
      };
    })(this));
    this.logger.debug("About to send " + (_.size(posts)) + " requests");
    return Q.all(posts);
  };

  return StockImport;

})();

module.exports = StockImport;
