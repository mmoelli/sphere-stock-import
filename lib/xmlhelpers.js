/* ===========================================================
# sphere-stock-import - v0.5.11
# ==============================================================
# Copyright (c) 2013,2014 Hajo Eichler
# Licensed under the MIT license.
*/
var parseString, _;

_ = require('underscore');

parseString = require('xml2js').parseString;

exports.xmlFix = function(xml) {
  if (!xml.match(/\?xml/)) {
    xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" + xml;
  }
  return xml;
};

exports.xmlTransform = function(xml, callback) {
  return parseString(xml, callback);
};

exports.xmlVal = function(elem, attribName, fallback) {
  if (elem[attribName]) {
    return elem[attribName][0].trim();
  }
  return fallback;
};
