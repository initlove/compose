var exec = require('child_process').exec;
var utils = require('./utils');
var desktop = require('./desktop');
var walk = require('walk');
var fs = require('fs');
var path = require('path');
var mime = require('mime');
var libxml = require('libxmljs');
var mongodb = require('mongodb');
var Db = mongodb.Db;
var Server = mongodb.Server;
var GridStore = require('mongodb').GridStore;
var EventEmitter = require('events').EventEmitter;

exports.get = function(req) {
    var emitter = new EventEmitter();
    var cache_dir = utils.cache_dir(req.body.base_uri);
    var data_dir = utils.data_dir(req.body.base_uri);

    var base_uri = req.body.base_uri;
    /*Is there any lib like path, but build the url ? */
    if (base_uri[base_uri.length-1] != '/')
        base_uri+='/';
 
    function load_icons(required_icons) {
        console.log("load icons now");
        emitter.emit('status', 'start to load icons');

        var icon_dir = cache_dir + '/usr';
        var walker  = walk.walk(icon_dir, { followLinks: false });
        var icons = {};
        for(var i = 0; i < required_icons.length; i++) {
            icons[required_icons[i]] = 'init';
        }
        walker.on('file', function(root, stat, next) {
            if (stat.name.match(/(png|svg|svgz|jpg|jpeg)$/g)) {
                var _name = stat.name.split(/\./g);
                var icon_name = _name[0];
                if (icons[icon_name] == 'init') {
                    icons[icon_name] = root + '/' + stat.name;
                } else if (stat.name.match(/64x64/g)) {
                    /*64x64 take the highest priority,
                     * donnot care about other sequence currently.
                     */
                    icons[icon_name] = root + '/' + stat.name;
                }
            }
            next();
        });
        walker.on('end', function() {
            var cp_cmd = 'cd '+data_dir+'; mkdir icons/64 -p; cd icons/64; ';
           for (_icon_name in icons) {
                if (_icon_name && _icon_name != 'init') {
                    cp_cmd += 'cp '+icons[_icon_name]+' . & ';
                }
            }
            var child = exec(cp_cmd, function(err, stdout, stderr) {
                if (err) {
                    emitter.emit('error', 'fail to get icon');
                }
                emitter.emit('done', 'metadata generated');
            });
        });
    }

    function extra_data(req, rpms, file_pattern, callback) {
        emitter.emit('status', 'start to extra data');

        var wget = 'wget -P ' + cache_dir + ' ';
        var i = 0;
        for(var pkg in rpms) {
            i++;
            wget += ' ' + base_uri + pkg + ' ';
            if (i > 20)
                break;
        }
        //TODO: Put logs to a file?
        var child = exec(wget, function(err, stdout, stderr) {
        console.log(wget);
            if (err) {
                console.log("err in exec wget" + err);
                callback(false, 'extra_data error: fail to get rpms');
            } else {
                var extra_cmd = 'cd ' + cache_dir + ' ; ';
                var cpio = ' | cpio -icud ' + file_pattern + ' & ';
                var i = 0;
                for(var pkg in rpms) {
                    var pkg_name = pkg.split("/");
                    extra_cmd += ' rpm2cpio '+pkg_name[pkg_name.length-1]+ cpio;
                    i++;
                    if (i > 20)
                        break;
                }
                console.log(extra_cmd);
                var extra_child = exec(extra_cmd, function(err, stdout, stderr) {
                    if (err) {
                        console.log("err in extra" + err);
                        callback(false, 'extra_data error: fail to cpio');
                    } else {
                        callback(true);
                    }
                });
            }
        });
    };

    function parse_metadata() {
        emitter.emit('status', 'start to parse metadata');

        var archive_file = cache_dir + '/ARCHIVES';
        var rpms = {};
        var imgs = {};
        
        var content = null;
        try {
            content = fs.readFileSync(archive_file);
        } catch (err) {
            return emitter.emit('failed', 'fail to load ARCHIVES');
        }
        if (content) {
            var begin = end = 0;
            var buf = null;
            for (var i = 0; i < content.length; i ++){
                if (content[i] != 10)
                    continue;
                end = i;
                buf = content.slice(begin, end-1).toString();
                begin = i+1;
                if (buf.match(/desktop$/g)) {
                    var props = buf.split(/(\s+|:)/g);
                    var rpm_name = props[0];
                    var desktop_name = props[props.length -1];
                    if (!rpms[rpm_name])
                        rpms[rpm_name] = true;
                } else if (buf.match(/(png|jpg|svg|svgz|jpeg)$/g)) {
                    var props = buf.split(/(\s+|:)/g);
                    var rpm_name = props[0];
                    var img_name = props[props.length -1];
                    var _icon_name = img_name.split(/\/|\./g);
                    var icon_name = _icon_name[_icon_name.length-2];
                    if (!imgs[icon_name]) {
                        imgs[icon_name] = rpm_name;
                    } else if (img_name.match(/64x64/g)) {
                        imgs[icon_name] = rpm_name;
                    }
                }   
            }
            extra_data(req, rpms, '"*desktop" "*png" "*jpg" "*svg" "*svgz" "*jpeg"', function(r, msg) {
                if (r) {
                    desktop.load(cache_dir, function(desktop_files) {
                        var doc = desktop.get_doc(desktop_files);
                        var required_icons = desktop.get_icons(doc);
                        var img_rpms = {};
                        var found = false;
                        for (var i = 0; i < required_icons.length; i++) {
                            var _rpm_name = imgs[required_icons[i]];
                            if (_rpm_name && !rpms[_rpm_name] && !img_rpms[_rpm_name]) {
                                if (!found)
                                    found = true;
                                img_rpms[_rpm_name] = true;
                            }
                        }
                        if (found) {
                            extra_data(req, img_rpms, '"*png" "*jpg" "*svg" "*svgz" "*jpeg"', function(r, msg) {
                                if (!r) {
                                    emitter.emit('error', msg);
                                }
                                load_icons(required_icons);
                            });
                        } else {
                            load_icons(required_icons);
                        }
                        desktop.save_doc(path.join(utils.data_dir(req.body.base_uri), 'appdata.xml'), doc);
                    });
                } else {
                    emitter.emit('failed', msg);
                }
            });
        } else {
            emitter.emit('failed', 'empty ARCHIVES');
        }
    }

    function generate_metadata() {
        emitter.emit('status', 'start to generate metadata');

        var archive_gz_file = base_uri + 'ARCHIVES.gz';

        utils.download(archive_gz_file, cache_dir, function(r, msg) {
            if (r) {
                var tar_cmd = 'cd '+cache_dir+' ; gunzip ARCHIVES.gz';
                var child = exec(tar_cmd, function(err, stdout, stderr) {
                    if (err) {
                        emitter.emit('failed', 'fail to unzip ARCHIVED.gz');
                    } else {
                        parse_metadata();
                    }
                });
            } else {
                emitter.emit('failed', 'fail to download ARCHIVED.gz');
            }
        });
    };

    function  get_metadata() {
        emitter.emit('status', 'start to download metadata');

        var appdata = base_uri + 'appdata.xml';
        var appicons = base_uri + 'icons.tar.gz';

        utils.download(appdata, data_dir, function(r, msg) {
            if (r) {
                utils.download(appicons, data_dir, function(r, msg) {
                    if (r) {
                        var tar_cmd = 'cd '+data_dir+' ; tar xzvf icons.tar.gz';
                        var child = exec(tar_cmd, function(err, stdout, stderr) {
                            if (err) {
                                emitter.emit('error', 'fail to untar icons.tar.gz');
                                generate_metadata();
                            } else {
                                emitter.emit('done', 'get the metadata');
                            }
                        });
                    } else {
                        emitter.emit('error', 'fail to download icons.tar.gz');
                        generate_metadata();
                    }
                });
            } else {
                emitter.emit('error', 'fail to download appdata.xml');
                generate_metadata();
            }
        });
    };
    parse_metadata();
//    get_metadata();
    return emitter;
};


function save_image(db, filename, path, callback) {
    var gridStore = new GridStore(db, filename, 'w+',  
                            {'content_type': mime.lookup(path),
                             'metadata': {'contentType': mime.lookup(path)}
                            });
    gridStore.open(function(err, gridStore) {
        if (err) {
            console.log(err);
            callback(false, err);
            return;
        }
        fs.readFile(path, function(err, imageData) {
            if (err) {
                console.log(err);
                callback(false, err);
                return;
            }
            gridStore.write(imageData, function(err, gridStore) {
                if (err) {
                    callback(false, err);
                    return;
                }
                gridStore.close(function(err, result) {
                    if (err) {
                        callback(false, err);
                        return;
                    } else {
                        callback(true);
                    }
                });
            });
        });
    });
};

function push_icons(req, callback) {
    var icon_dir = path.join(utils.data_dir(req.body.base_uri), "/icons/64");

    var db = new Db('stock', new Server("127.0.0.1", 27017));
    db.open(function(err, db) {
        if (err)
            return callback(false, err);
        var walker  = walk.walk(icon_dir, { followLinks: false });
        walker.on('file', function(root, stat, next) {
            if (stat.name.match(/(png|svg|svgz|jpg|jpeg)$/g)) {
                var _name = stat.name.split(/\./g);
                var icon_name = _name[0];
                GridStore.exist(db, icon_name, function(err, result) {
                    if (err || !result) {
                        save_image(db, icon_name, root+'/'+stat.name, function(r, msg){
                            next();
                        });
                    }
                });
            };
        });

        walker.on('end', function() {
            db.close();
            callback(true);
        });
    });
};

function push_apps(req, callback) {
    var file = utils.data_dir(req.body.base_uri)+'/appdata.xml';
    var content = null;
    try {
        content = fs.readFileSync(file).toString();
    } catch (err) {
        return callback(false, err);
    }
    var doc = libxml.parseXmlString(content);
    var apps = doc.root().childNodes();
    var data = [];

    for (var i = 0; i < apps.length ; i++) {
        var elems = apps[i].childNodes();
        var app = {};
        var download = {'pkgrepo': req.body.base_uri};
        for (var j = 0; j < elems.length; j++) {
            var attr = elems[j].attr('type');
            if (attr) {
                if (attr.value() == 'desktop')
                    continue;
            }
            if (elems[j].name() == 'appcategories') {
                var cates = elems[j].childNodes();
                app.appcategories = [];
                for (var k = 0; k < cates.length; k++) {
                    if (cates[k].text())
                        app.appcategories.push(cates[k].text());
                }
            } else if (elems[j].name() == 'mimetypes') {
            } else if (elems[j].name() == 'pkgname') {
                download.pkgname = elems[j].text();
            } else {
                app[elems[j].name()] = elems[j].text();
            }   
        }
        app.download = [];
        app.download.push(download);
        data.push(app);
    }

    var db = new Db('apps', new Server("127.0.0.1", 27017));
    db.open(function(err, db) {
        if (err)
            return callback(false, err);
        db.collection("content", function(err, collection) {
            collection.insert(data, function(err, result) {
                if (err) {
                    return callback(false, err);
                } else {
                    db.close();
                    return callback(true);
                }
            });
        });
    });
};

exports.push = function(req, callback) {
    push_icons(req, function(r, msg) {
        if (r) {
            push_apps(req, callback);
        } else {
            callback(r, msg);
        }
    });
};
