var metadata = require('./metadata');
var utils = require('./utils');
var repo_queue = [{"name":"adsf", "status": "fake"}];

function remove_repo(req, callback) {
    exports.status_change(req.body.base_uri, "Start to remove");
    /*TODO: remove from the server */
    callback(true);
};

function add_repo(req, callback) {
    exports.status_change(req.body.base_uri, "Getting the metadata");
    /*TODO: may add 'on status change' to push object, so change status by monitor it */
    /* use EventEmitter*/
    var data_dir = utils.data_dir(req.body.base_uri);
    var cache_dir = utils.cache_dir(req.body.base_uri);
    utils.prepare_dir(data_dir, function(r, msg) {
        if (r) {
            utils.prepare_dir(cache_dir, function(r, msg) {
                if (r) {
                    var monitor = metadata.get(req);
                    monitor.on('error', function(msg){
                        console.log("error in get metadata: " + msg);
                    });
                    monitor.on('failed', function(msg) {
                        console.log("fail to get metadata: " + msg);
                        callback(false, msg);
                    });
                    monitor.on('status', function(msg) {
                        console.log('status changed: '+msg);
                        exports.status_change(req.body.base_uri, msg);
                    });
                    monitor.on('done', function(msg) {
                        console.log("done, push the metadata to db");
                        metadata.push(req, callback);
                    });
                } else {
                    callback(r,msg);
                }
            });
        } else
            callback(r, msg);
    });
};

exports.add = function(req, res) {
    if (!req.body.base_uri)
        return res.send("Miss base_uri");
    var base_uri = req.body.base_uri;
    for (var i = 0; i < repo_queue.length; i++) {
        if (repo_queue[i].name == base_uri) {
            console.log("we have cached this repo");
            if (req.body.reload) {
                return remove_repo(req, function(r, msg) {
                    if (r) {
                        add_repo (req, function(r, msg) {
                            if (r) {
                                return res.send("The repo: " + base_uri + " success composed");
                            } else {
                                return res.send(msg);
                            }
                        });
                    } else {
                        return res.send(msg);
                    }
                });
            } else {
                return res.send("The repo is already composed, you can use 'reload=true' to re-compose the repo.");
            }
        }
    }
    add_repo(req, function(r, msg) {
        if (r) {
            return res.send("The repo: " + base_uri + " success composed");
        } else {
            return res.send(msg);
        }
    });
};

exports.remove = function(req, res) {
    if (!req.body.base_uri)
        return res.send("Miss base_uri");

    var base_uri = req.body.base_uri;
    for (var i = 0; i < repo_queue.length; i++) {
        if (repo_queue[i].name == base_uri) {
            return exports.remove(base_uri, function(r, msg) {
                if (r) {
                } else {
                    res.send(msg);
                }
            });
        }
    }
};

exports.list = function(req, res) {
    res.send(repo_queue);
};

exports.status = function(req, res) {
    var base_uri = decodeURIComponent(req.params.base_uri);
    for (var i = 0; i < repo_queue.length; i++) {
        if (repo_queue[i].name == base_uri) {
            return res.send(repo_queue[i]);
        }
    }
    return res.send("not composed");
};

exports.status_change = function(base_uri, status) {
    for (var i = 0; i < repo_queue.length; i++) {
        if (repo_queue[i].name == base_uri) {
            if (repo_queue[i].status == status) {
                return 'same status';
            } else {
                repo_queue[i].status = status;
                return 'status change';
            }
        }
    }
    var new_repo = {"name": base_uri, "status": status};
    repo_queue.push(new_repo);
    return 'new repo added';
};

