const socketCluster = require('socketcluster-client');
const net = require('net');
const fs = require('fs');
const os = require('os');

"use strict";

const PriceCollector = {
    data: {},
    socket_client: null,

    push: function(market, pair, price, total, time_str) {
        const timestamp = (new Date(time_str)).getTime();
        this._initStructure(market, pair);
//        this.data[market][pair]['data'].push(price, total, timestamp);
        this.data[market][pair]['data'].push(price);

        //@todo just for test
        if(this.data[market][pair]['min'] > price) {
            this.data[market][pair]['min'] = price;
            let data = JSON.stringify([market, pair, price, total, time_str]) + os.EOL;

            if(this.socket_client !== null) {
                this.socket_client.write(data);
            }
        }
    },

    _initStructure: function(market, pair) {
        if(!this.data[market]) {
            this.data[market] = {};
        }
        if(!this.data[market][pair]) {
            this.data[market][pair] = {
                data: [],
                min: 99999999999999999 //@todo
                //object here
            };
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