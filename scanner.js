const net = require('net');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const CryptoCollector = require('./crypto_collector');

"use strict";

const Analyser = function() {
    const TEN_MINUTES = 600 * 1000;
    const HOUR = 6 * TEN_MINUTES;
    const DAY = 24 * HOUR / TEN_MINUTES;
    const data = {
        low: new Map(),
        last_lowest_times: new Map(), //for preventing one-by-one alerting of a single event
        last_time: null
    };

    this.getData = function () {
        return data;
    };

    this.restoreData = function(import_data) {
        for(let i in import_data) {
            if(!import_data.hasOwnProperty(i)) {
                continue;
            }
            data[i] = Array.isArray(import_data[i]) ? new Map(import_data[i]) : import_data[i];
        }
    };

    this.push = function(value, time) {
        data.last_time = Math.floor(time / TEN_MINUTES);
        let lowest = data.low.get(data.last_time);
        if(lowest === undefined || lowest > value) {
            data.low.set(data.last_time, value);
        }
    };

    this.findLastMin = function() {
        let min_key = data.last_time;
        let now = min_key;
        let times = new Map([[DAY * 3, null], [DAY * 2, null], [DAY, null], [DAY * 0.5, null]]);

        for(let [key, val] of data.low.entries()) {
            for(let [time_i, cur_min] of times) {
                if(now - key <= time_i) {
                    if(cur_min === null || cur_min[1] > val) {
                        times.set(time_i, [key, val]);
                    }
                }
            }
        }

        //@todo move to a separated method
        //preparing for sending
        let result = [];
        for(let [key, val] of times.entries()) {
            let last_min = data.last_lowest_times.get(key);
            if(val[0] === min_key
                && (last_min === undefined || last_min[0] !== min_key)) {
                result.push(key / DAY);
            }
        }
        data.last_lowest_times = times;
        return result;
    };

    this.clean = function() {
        let lowest_time = data.last_time - 3 * DAY;
        for(let key of data.low.keys()) {
            if(key < lowest_time) {
                data.delete(key);
            }
        }
    };
};

const PriceCollector = {
    backup_file: __dirname + '/backup_data',
    data: {},
    socket_client: null,

    push: function(market, pair, price) {
        const timestamp = Date.now();
        this._initStructure(market, pair);
        this.data[market][pair].push(price, timestamp);

        //@todo make by timer
        if(this.socket_client !== null) {
            let last_find = this.data[market][pair].findLastMin();
            if(last_find.length !== 0) {
                let data = JSON.stringify([market, pair, price, timestamp, last_find]) + os.EOL;
                this.socket_client.write(data);
            }
        }
    },

    _initStructure: function(market, pair) {
        if(!this.data[market]) {
            this.data[market] = {};
        }
        if(!this.data[market][pair]) {
            this.data[market][pair] = new Analyser();
            setInterval(() => {
                this.data[market][pair].clean();
            }, 60000);
        }
    },

    extract: function(callback) {
        let wstream = fs.createWriteStream(this.backup_file, {flags: 'w'});
        for (let i in this.data) {
            for (let j in this.data[i]) {
                wstream.write(JSON.stringify([i, j, JSON.stringify(this.data[i][j].getData(), (key, val) => {
                        if (typeof val === "object" && val !== null
                            && val.__proto__.toString() === "[object Map]") {
                            return Array.from(val);
                        }
                        return val;
                    })]) + os.EOL);
            }
        }
        wstream.end(() => {
            if(callback && typeof callback === 'function') {
                callback();
            }
        });
    },

    restore: function() {
        fs.stat(this.backup_file, err => {
            if (err) {
                return;
            }
            const read_stream = fs.createReadStream(this.backup_file);
            const rl = readline.createInterface({
                input: read_stream
            });

            rl.on('line', (line) => {
                let obj = JSON.parse(line);
                this._initStructure(obj[0], obj[1]);
                this.data[obj[0]][obj[1]].restoreData(JSON.parse(obj[2]));
            });
        });
    }

};

const Scanner = function() {
    let collector = new CryptoCollector();
    collector.on('ticker', (data) => {
        PriceCollector.push(data['exchange'], data['label'], data['price']);
    });
    collector.run();
};

PriceCollector.restore();
const socket_path = __dirname + '/pipe.sock';
fs.stat(socket_path, err => {
    if (!err) {
        fs.unlinkSync(socket_path);
    }

    const unix_server = net.createServer(client => {
        console.log('unix socket server');
        client.on('close', () => {
            PriceCollector.socket_client = null;
        });
        PriceCollector.socket_client = client;
    });

    unix_server.listen(socket_path);
    unix_server.on('error', err => {
        console.log(err);
    }).on('close', () => {
        PriceCollector.socket_client = null;
    })
});

Scanner();

process.on('SIGINT', () => {
    PriceCollector.extract(() => {
        process.exit();
    });
});
process.on('uncaughtException', err => {
    console.log(err);
    PriceCollector.extract();
});
