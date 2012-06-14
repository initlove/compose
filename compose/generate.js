var fs = require('fs');
var exec = require('child_process').exec;
var walk = require('walk');
var desktopToXml = require('./desktop');

var prepared_dir = '/tmp/dl_app_store';
var cache_dir = '/tmp/dl_001';
var base_uri = "http://147.2.207.240/repo/opensuse-12.1-i586/";

var compose_repos = [];

function load_icons(base_uri, cache_dir, required_icons) {
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
        var cp_cmd = 'cd ' + cache_dir + '; mkdir icons/64 -p; cd icons/64; ';
        for (_icon_name in icons) {
            if (_icon_name && _icon_name != 'init') {
                cp_cmd += 'cp ' + icons[_icon_name] + ' . & ';
            }
        }
        var child = exec(cp_cmd, function(err, stdout, stderr) {
            if (err) {
                console.log("fail to generate icon");
            } else {
                console.log("generate icons");
            }
        });
    });
}

function load_desktops(base_uri, cache_dir, imgs) {
    var desktop_dir = cache_dir + '/usr';
    var desktop_files = [];
    /*the icons get from the pkg */
    var icons = {};
    var walker  = walk.walk(desktop_dir, { followLinks: false });

    walker.on('file', function(root, stat, next) {
        if (stat.name.match(/desktop$/g)) {
            desktop_files.push(root + '/' + stat.name);
        } else if (stat.name.match(/(png|svg|svgz|jpg|jpeg)$/g)) {
            var _name = stat.name.split(/\./g);
            var icon_name = _name[0];
            if (!icons[icon_name]) {
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
        var doc = desktopToXml.get_doc(desktop_files);
        var required_icons = desktopToXml.get_icons(doc);
        var todo_rpms = {};
        var todo = false;
        for(var i = 0; i < required_icons.length; i++) {
            if (!icons[required_icons[i]]) {
                var _rpm = imgs[required_icons[i]];
                if (_rpm) {
                    if (!todo_rpms[_rpm]) {
                        todo_rpms[_rpm] = true;
                        if (!todo)
                            todo = true;
                    }
                }
            } else {
            }
        }
        if (todo) {
            extra_data(base_uri, cache_dir, todo_rpms, '"*png" "*jpg" "*svg" "*svgz" "*jpeg"', function(r) {
                if (r) {
                    load_icons(base_uri, cache_dir, required_icons);
            } else {
                }
            });
        } else {
            load_icons(base_uri, cache_dir, required_icons);
        }

        desktopToXml.save_doc(cache_dir + "/appdata.xml", doc);
    });
}

function get_metadata(base_uri, cache_dir) {
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
        extra_data(base_uri, cache_dir, rpms, '"*desktop" "*png" "*jpg" "*svg" "*svgz" "*jpeg"', function(r) {
            if (r) {
                load_desktops(base_uri, cache_dir, imgs);
            } else {
            }
        });
    } 
}

function extra_data(base_uri, cache_dir, rpms, file_pattern, callback) {
    var wget = 'wget -P ' + cache_dir + ' ';
    var i = 0;
    for(var pkg in rpms) {
        i++;
        wget += ' ' + base_uri + pkg;
        if (i > 20)
            break;
    }
    var child = exec(wget, function(err, stdout, stderr) {
            console.log("get error" + err);
            callback(false);
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
                    console.log("fail to cpio");
                    callback(false);
                } else {
                    console.log("success in cpio");
                    callback(true);
                }
            });
        }
    });
}

exports.prepare_data = function (base_uri, repo_name) {
    var dir_name = prepared_dir+'/'+encodeURIComponent(base_uri);
    var dir_cmd = 'rm -fr '+dir_name+' & mkdir -p '+ dir_name;
};

get_metadata(base_uri, cache_dir);
//load_desktops(cache_dir);
