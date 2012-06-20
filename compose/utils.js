var fs=require('fs');
var exec = require('child_process').exec;
var url = require('url');
var http = require('http');

exports.prepare_dir = function(dir, callback) {
    //HACK
return    callback(true);
    var dir_cmd = "./prepare_dir " + dir;
    var child = exec(dir_cmd, function(err, stdout, stderr) {
        if (err) {
            console.log(err);
            callback(false, err);
        } else {
            if (stdout)
                console.log(stdout);
            else
                console.log(stderr);
            callback(true);
        }
    });
};

exports.cache_dir = function(base_uri) {
    return '/tmp/.appstore/cache/'+encodeURIComponent(base_uri);
};  

exports.data_dir = function(base_uri) {
    return '/tmp/.appstore/data/'+encodeURIComponent(base_uri);
};

exports.download = function(source_url, dest_dir, callback) {
    var options = {
        host: url.parse(source_url).host,
        port: 80,
        path: url.parse(source_url).pathname
    };

    http.get(options, function(res) {
        var file = null;
        if (res.statusCode == 200) {
            var file_name = url.parse(source_url).pathname.split('/').pop();
            file = fs.createWriteStream(dest_dir+'/'+file_name);
        } else {
            return callback(false, res.statusCode);
        }
        res.on('data', function(data) {
            file.write(data);
        }).on('end', function() {
            file.end();
            callback(true);
        });
    }).on('error', function(e) {
        callback(false, e.message);
    });
};
