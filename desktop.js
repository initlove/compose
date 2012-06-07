var libxml = require("libxmljs");
var fs = require('fs');
var file = 'parcellite.desktop';

exports.get_desktop = function(file, doc) {
    var content = fs.readFileSync(file).toString();
    if (content) {
        var array = content.split("\n");
        var length = array.length;
        var item = {};
        for (var i = 0; i < length; i++) {
            var key_value = array[i].split("=");
            if (key_value.length == 2) {
                item[key_value[0]] = key_value[1];
            }
        }
        if (item["Type"] == null || item["Type"] != "Application") {
            return null;
        } else {
//            var root = doc.node('applications');
            var elem = libxml.Element(doc, 'application');
            var node = libxml.Element(doc, 'id', file);
            node.attr({'type': 'desktop'});
            elem.addChild(node);
            for (var key in item) {
                if (key == 'Categories'|| key == 'Mimetypes') {
                    var _child_key = null;
                    if (key == 'Categories')
                        _child_key = 'category';
                    else
                        _child_key = 'mimetype';

                    var node = libxml.Element(doc, key.toLowerCase());
                    var _keys = item[key].split(";");
                    for (var i = 0; _keys[i]; i++) {
                        var _child_node = libxml.Element(doc, _child_key, _keys[i]);
                        node.addChild(_child_node);
                    }
                } else if (key == "Icon") {
                    var node = libxml.Element(doc, key.toLowerCase(), item[key]);
                    node.attr({'type':'stock'});
                } else {
                    var langs = /([^\[]+)\[([^\]]+)\]/.exec(key);
                    var node = {};
                    if (langs) {
                        node = libxml.Element(doc, langs[1].toLowerCase(), item[key]);
                        node.attr({'lang': langs[2]});
                    } else {
                        node = libxml.Element(doc, key.toLowerCase(), item[key]);
                    }
                }
                elem.addChild(node);
            }
            return elem;
        }
    } else {
        return null;
    }
}

exports.get_doc = function(files) {
    var doc = new libxml.Document();
    var root = doc.node('applications');
    for (var i = 0; i < files.length; i++) { 
        var elem = exports.get_desktop (files[i], doc);
        if (elem) {
            root.addChild(elem);
        }
    }
//    console.log(doc.toString());
    return doc;
}

exports.get_icons = function(doc) {
    //FIXME: xpath might be much better !
    var apps = doc.root().childNodes();
    var icons = [];
    for (var i = 0; i < apps.length ; i++) {
        var elems = apps[i].childNodes();
        for (var j = 0; j < elems.length; j++) {
            if ((elems[j].name() == "icon") && elems[j].text) {
                icons.push(elems[j].text());
            }
        }
    }
    return icons;
}

exports.save_doc = function(file, doc) {
    fs.writeFileSync(file, doc.toString());
}
