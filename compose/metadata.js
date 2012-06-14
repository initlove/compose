var exec = require('child_process').exec;
var utils = require('./utils');
var mime = require('mime');
var mongodb = require('mongodb');
var GridStore = require('mongodb').GridStore;
var EventEmitter = require('events').EventEmitter

exports.get = function(req) {
    var emitter = new EventEmitter();
    var base_uri = req.body.base_uri;
    var cache_dir = utils.cache_dir(req.body.base_uri);
    var data_dir = utils.data_dir(req.body.base_uri);
 
    function load_icons(required_icons) {
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
            wget += ' ' + base_uri + pkg;
            if (i > 20)
                break;
        }
        var child = exec(wget, function(err, stdout, stderr) {
            if (err) {
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
                var extra_child = exec(extra_cmd, function(err, stdout, stderr) {
                    if (err) {
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
        var content = fs.readFileSync(archive_file).toString();
        if (content) {
            var array = content.split("\n");
            var app = {};
            for(var i = 0; i < array.length; i++) {
                if (array[i].match("--->")) {
                    app.url = array[i].substr(5);
                } else if (array[i].match(/desktop$/g)) {
                    var props = array[i].split(/(\s+|:)/g);
                    var rpm_name = props[0];
                    var desktop_name = props[props.length -1];
                    if (!rpms[rpm_name])
                        rpms[rpm_name] = true;
                } else if (array[i].match(/(png|jpg|svg|svgz|jpeg)$/g)) {
                    var props = array[i].split(/(\s+|:)/g);
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
                            if (!rpms[_rpm_name] && !img_rpms[_rpm_name]) {
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

        var archive_gz_file = base_uri+'/ARCHIVES.gz';

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

        var appdata = base_uri+'/appdata.xml';
        var appicons = base_uri+'/icons.tar.gz';

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
    get_metadata();
    return emitter;
};

function push_icons(req, callback) {
    var dbname="mongodb://127.0.0.1:27017/stock";
    mongodb.connect(dbname, function(err, connect) {
                    
        var gridStore = new GridStore(connect, app.icon, 'w+', {
            "content_type": mime.lookup(uri),
            'metadata': {'contentType': mime.lookup(uri)}
        });
    });
};

function push_apps(req, callback) {
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