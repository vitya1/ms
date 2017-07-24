const socketCluster = require('socketcluster-client');
const net = require('net');
const fs = require('fs');
const os = require('os');
const readline = require('readline');

"use strict";

//@todo now its only the lowest price for the last 3 days
const Analyser = function() {
    const TEN_MINUTES = 600 * 1000;
    const HOUR = 6 * TEN_MINUTES;
    const LOW_INTERVAL_LENGTH = 3 * 24 * HOUR / TEN_MINUTES;
    const data = {
        low: new Map(),
        last_lowest_time: null,
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

    this.isLastMin = function() {
        let min = data.low.get(data.last_time);
        let min_key = data.last_time;
        for(let [key, value] of data.low.entries()) {
            if(min > value) {
                min = value;
                min_key = key;
            }
        }

        //@todo make min_key_12h min_key_24h....
        return data.last_time === min_key;
    };

    this.clean = function() {
        for(let key of data.low.keys()) {
            if(key < LOW_INTERVAL_LENGTH) {
                data.delete(key);
            }
        }
    };
};

const PriceCollector = {
    backup_file: __dirname + '/backup_data',
    data: {},
    socket_client: null,

    push: function(market, pair, price, total, time_str) {
        const timestamp = (new Date(time_str)).getTime();
        this._initStructure(market, pair);
        this.data[market][pair].push(price, timestamp);

        //@todo make by timer
        if(this.data[market][pair].isLastMin() && this.socket_client !== null) {
            let data = JSON.stringify([market, pair, price, total, time_str]) + os.EOL;
            this.socket_client.write(data);
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
//an empty account's api keys, please do not touch
    const api_credentials = {
        "apiKey"    : "73544a7ef7f9765195618e2081bf5e3e",
        "apiSecret" : "cdfab78a10c1eda4b1fe844a2e65642d"
    };

    const sc_socket = socketCluster.connect({
        hostname  : "sc-02.coinigy.com",
        port      : "443",
        secure    : "true"
    });

    sc_socket.on('connect', function (status) {

        console.log(status);

        sc_socket.on('error', function (err) {
            console.log(err);
        });

        sc_socket.emit('auth', api_credentials, function (err, token) {
            if (err || !token) {
                console.log(err);
                return;
            }

            const chanels = [];
            let chanels_cnt = 0;
            sc_socket.emit('exchanges', null, function (err, data) {
                if (err) {
                    console.log(err);
                    return;
                }

                for(let i = 0; i < data[0].length; i++) {
                    let market_name = data[0][i]['exch_code'];
                    //console.log(market_name);

                    sc_socket.emit('channels', market_name, function (err, market_data) {
                        if (err) {
                            console.log(err);
                            return;
                        }

                        for(let j = 0; j < market_data[0].length; j++) {
                            let chanel = market_data[0][j]['channel'];
                            if(chanel.indexOf('TRADE') === 0) {
                                //console.log(chanel, chanels_cnt++);
                                let sc_channel = sc_socket.subscribe(chanel);
                                sc_channel.watch(function (data) {
                                    PriceCollector.push(data['exchange'], data['label'],
                                        data['price'], data['total'], data['timestamp']);
                                });
                                chanels.push(sc_channel);
                            }
                        }
                    });
                }
            });
        });
    });
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
