const socketCluster = require('socketcluster-client');
const net = require('net');
const fs = require('fs');
const os = require('os');

"use strict";

//@todo now its only the lowest price for the last 3 days
const Analyser = function() {
    const TEN_MINUTES = 600 * 1000;
    const HOUR = 60 * TEN_MINUTES;
    const LOW_INTERVAL_LENGHT = 3 * 3600 * 1000 / TEN_MINUTES;
    const data = {
        low: new Map(),
        last_lowest_time: null,
    };

    this.push = function(value, time) {
        let ten_m_time = Math.floor(time / TEN_MINUTES);
        let lowest = data.low.get(ten_m_time);
        if(lowest === undefined || lowest > value) {
            data.low.set(ten_m_time, value);
        }
    };

    this.analytics = function() {
        let prev_min = data.last_lowest_time;
        let min = 999999999999999; //@todo
        for(let [key, value] of data.low.entries()) {
            if(min > value) {
                min = value;
            }
        }
        data.last_lowest_time = min;
        return min == prev_min;
    };

    this.clean = function() {
        for(let key of data.low.keys()) {
            if(key < LOW_INTERVAL_LENGHT) {
                //@todo key is not time here but number of ten-munutes period
                data.delete(key);
            }
        }
    };
};

const PriceCollector = {
    data: {},
    socket_client: null,

    push: function(market, pair, price, total, time_str) {
        const timestamp = (new Date(time_str)).getTime();
        this._initStructure(market, pair);
        this.data[market][pair].push(price);

        //@todo make by timer
        if(this.data[market][pair].analytics() && this.socket_client !== null) {
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

const socket_path = __dirname + '/pipe.sock';
fs.stat(socket_path, function(err) {
    if (!err) {
        fs.unlinkSync(socket_path);
    }

    const unix_server = net.createServer(function(client) {
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

/*
penny stock example:
- <= 1 penny (LAST >= 1p)
- >= 5$ (LAST <= 5$)
- 5 min percent change more than 10% (5 min percent change <= - 10%)

cryptocurrency:
- coin more than 2000$ per day trades
- bellow than low of the past 3 days of trading
 */