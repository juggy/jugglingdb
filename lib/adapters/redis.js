/**
 * Module dependencies
 */
var redis = require('redis');

exports.initialize = function initializeSchema(schema, callback) {
    schema.client = redis.createClient(
        schema.settings.port,
        schema.settings.host,
        schema.settings.options
    );

    schema.client.auth(schema.settings.password);
    schema.client.on('connect', callback);

    schema.adapter = new BridgeToRedis(schema.client);
};

function BridgeToRedis(client) {
    this._models = {};
    this.client = client;
    this.indexes = {};
}

BridgeToRedis.prototype.define = function (descr) {
    var m = descr.model.modelName;
    this._models[m] = descr;
    this.indexes[m] = {};
    Object.keys(descr.properties).forEach(function (prop) {
        if (descr.properties[prop].index) {
            this.indexes[m][prop] = descr.properties[prop].type;
        }
    }.bind(this));
};

BridgeToRedis.prototype.defineForeignKey = function (model, key, cb) {
    this.indexes[model][key] = Number;
    cb(null, Number);
};

BridgeToRedis.prototype.save = function (model, data, callback) {
    var log = this.logger('HMSET ' + model + ':' + data.id + ' ...');
    this.client.hmset(model + ':' + data.id, data, function (err) {
        log();
        if (err) return callback(err);
        this.updateIndexes(model, data.id, data, callback);
    }.bind(this));
};

BridgeToRedis.prototype.updateIndexes = function (model, id, data, callback) {
    var i = this.indexes[model];
    var schedule = [];
    Object.keys(data).forEach(function (key) {
        if (i[key]) {
            schedule.push([
                'sadd',
                'i:' + model + ':' + key + ':' + data[key],
                model + ':' + id
            ]);
        }
    }.bind(this));

    if (schedule.length) {
        this.client.multi(schedule).exec(function (err) {
            callback(err);
        });
    } else {
        callback(null);
    }
};

BridgeToRedis.prototype.create = function (model, data, callback) {
    var log = this.logger('INCR id:' + model);
    this.client.incr('id:' + model, function (err, id) {
        log();
        data.id = id;
        this.save(model, data, function (err) {
            if (callback) {
                callback(err, id);
            }
        });

        // push the id to the list of user ids for sorting
        log('SADD s:' + model + ':' + data.id + ' ...');
        this.client.sadd("s:" + model, data.id);

    }.bind(this));
};

BridgeToRedis.prototype.exists = function (model, id, callback) {
    var log = this.logger('EXISTS ' + model + ':' + id);
    this.client.exists(model + ':' + id, function (err, exists) {
        log();
        if (callback) {
            callback(err, exists);
        }
    });
};

BridgeToRedis.prototype.find = function find(model, id, callback) {
    var t1 = Date.now();
    this.client.hgetall(model + ':' + id, function (err, data) {
        this.log('HGETALL ' + model + ':' + id, t1);
        if (data && data.id) {
            data.id = id;
        } else {
            data = null;
        }
        this.stringToType(model, data);
        callback(err, data);
    }.bind(this));
};

BridgeToRedis.prototype.destroy = function destroy(model, id, callback) {
    var t1 = Date.now();
    this.client.del(model + ':' + id, function (err) {
        this.log('DEL ' + model + ':' + id, t1);
        callback(err);
    }.bind(this));
    this.log('SREM s:' + model, t1);
    this.client.srem("s:" + model, id);
};

BridgeToRedis.prototype.possibleIndexes = function (model, filter) {
    if (!filter || Object.keys(filter.where || {}).length === 0) return false;

    var foundIndex = [];
    Object.keys(filter.where).forEach(function (key) {
        if (this.indexes[model][key] && typeof filter.where[key] === 'string') {
            foundIndex.push('i:' + model + ':' + key + ':' + filter.where[key]);
        }
    }.bind(this));

    return foundIndex;
};

BridgeToRedis.prototype.all = function all(model, filter, callback) {
    var ts = Date.now();
    var client = this.client;
    var log = this.log;
    var t1 = Date.now();
    var cmd;
    var that = this;
    var sortCmd = [];

    // ORDER
    if (filter && filter.order){
        var orders = filter.order;
        if (typeof filter.order === "string"){
            orders = [filter.order];
        }
        orders.forEach( function (key){
            sortCmd.push("BY", model + ":*->" + key);
        });
    }
    // LIMIT
    if (filter && filter.limit){
        var from = (filter.offset || 0), to = from + filter.limit;
        sortCmd.push("LIMIT", from, to);
    }

    // do we need to sort or to query normally
    if(sortCmd.length){
        sortCmd.unshift("s:" + model);
        sortCmd.push("GET", "#");
        cmd = "sort " + sortCmd.join(" ");
        sortCmd.push(function(err, ids){
            if (err) {
                return callback(err, []);
            }
            var keys = ids.map(function (i) {
                return model + ":" + i;
            });
            handleKeys(err, keys);
        });
        client.sort.apply(client, sortCmd);        
    }else{
        // Do a normal key lookup with possbible indexes
        var indexes = this.possibleIndexes(model, filter);
        if (indexes.length) {
            cmd = 'SINTER "' + indexes.join('" "') + '"';
            indexes.push(handleKeys);
            client.sinter.apply(client, indexes, handleKeys);
        } else {
            cmd = 'KEYS ' + model + ':*';
            client.keys(model + ':*', handleKeys);
        }
    }

    function handleKeys(err, keys) {
        log(cmd, t1);
        var t2 = Date.now();
        if (err) {
            return callback(err, []);
        }
        var query = keys.map(function (key) {
            return ['hgetall', key];
        });
        client.multi(query).exec(function (err, replies) {
            log(query, t2);
            // console.log('Redis time: %dms', Date.now() - ts);
            that.stringToType.call(that, model, replies);
            callback(err, filter ? replies.filter(applyFilter(filter)) : replies);
        });
    }
};

function applyFilter(filter) {
    if (typeof filter.where === 'function') {
        return filter.where;
    }
    var keys = Object.keys(filter.where || {});
    return function (obj) {
        var pass = true;
        keys.forEach(function (key) {
            if (!test(filter.where[key], obj[key])) {
                pass = false;
            }
        });
        return pass;
    }

    function test(example, value) {
        if (typeof value === 'string' && example && example.constructor.name === 'RegExp') {
            return value.match(example);
        }
        // not strict equality
        return example == value;
    }
}

BridgeToRedis.prototype.destroyAll = function destroyAll(model, callback) {
    var keysQuery = model + ':*';
    var t1 = Date.now();
    this.client.keys(keysQuery, function (err, keys) {
        this.log('KEYS ' + keysQuery, t1);
        if (err) {
            return callback(err, []);
        }
        var query = keys.map(function (key) {
            return ['del', key];
        });
        var t2 = Date.now();
        this.client.multi(query).exec(function (err, replies) {
            this.log(query, t2);
            callback(err);
        }.bind(this));
    }.bind(this));
};

BridgeToRedis.prototype.count = function count(model, callback) {
    var keysQuery = model + ':*';
    var t1 = Date.now();
    this.client.keys(keysQuery, function (err, keys) {
        this.log('KEYS ' + keysQuery, t1);
        callback(err, err ? null : keys.length);
    }.bind(this));
};

BridgeToRedis.prototype.updateAttributes = function updateAttrs(model, id, data, cb) {
    var t1 = Date.now();
    this.client.hmset(model + ':' + id, data, function () {
        this.log('HMSET ' + model + ':' + id, t1);
        this.updateIndexes(model, id, data, cb);
    }.bind(this));
};

BridgeToRedis.prototype.disconnect = function disconnect() {
    this.log('QUIT', Date.now());
    this.client.quit();
};

BridgeToRedis.prototype.stringToType = function stringToType(model, data) {
    var m = this._models[model];
    function array(a){
        a.forEach( function (d){
            object( d);
        });
    };

    function object(o){

        if(Array.isArray(o)){
            array(o);
        }else if(typeof o === "object" && o != null){
            Object.keys(o).forEach( function (attr){
                if(o[attr] === "null"){
                    o[attr] = null;
                }else{
                    // Convert to defined type
                    var type = m.properties[attr];
                    if(typeof type === "object") type = type.type;
                    if(type === Date) {
                        o[attr] = new Date(parseInt(o[attr]));
                    } 
                    else if(type && type === Boolean){
                        o[attr] = o[attr] === "true" ? true : false;
                    }
                    else if(type && type !== String && type.constructor.name !== "Text" && typeof type !== "undefined"){
                        o[attr] = new type(o[attr]);
                    }

                    if(type === Number){
                        o[attr] = o[attr].valueOf()
                    }
                }
            });
        }
    }
    object(data);
}
