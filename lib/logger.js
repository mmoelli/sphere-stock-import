/* ===========================================================
# sphere-stock-xml-import - v0.3.8
# ==============================================================
# Copyright (c) 2013,2014 Hajo Eichler
# Licensed under the MIT license.
*/
var Logger, package_json,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

Logger = require('sphere-node-utils').Logger;

package_json = require('../package.json');

module.exports = (function(_super) {
  __extends(_Class, _super);

  function _Class() {
    return _Class.__super__.constructor.apply(this, arguments);
  }

  _Class.appName = "" + package_json.name + "-" + package_json.version;

  return _Class;

})(Logger);
