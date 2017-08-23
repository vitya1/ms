const EventEmitter = require('events').EventEmitter;
const https = require('https');
const autobahn = require('autobahn');
const bittrex = require('node.bittrex.api');
const socketCluster = require('socketcluster-client');

'use strict';

class CryptoCollector extends EventEmitter {

    yobit() {
        const market = 'YOBT';
        const query_interval = 1000; // depends on yobit limit

        https.get('https://yobit.net/api/3/info', (res) => {
            let data = '';
            res.on('data', (d) => {
                data += d.toString();
            });
            res.on('end', () => {
                let res = JSON.parse(data);
                let pairs = [];
                for(let i in res['pairs']) {
                    pairs.push(i);
                }

                let c_size = 50;
                let j = 0;
                let interval = setInterval(() => {
                    let end = j + c_size > pairs.length ? pairs.length : j + c_size;
                    let chunk = pairs.slice(j, end).join('-');
                    https.get('https://yobit.net/api/3/ticker/' + chunk, (res) => {
                        let result = '';
                        res.on('data', function (d) {
                            result += d.toString();
                        });
                        res.on('end', () => {
                            let last_prices = JSON.parse(result);
                            for(let pair in last_prices) {
                                if(!last_prices.hasOwnProperty(pair)) {
                                    continue;
                                }
                                this.emit('ticker', {
                                    'exchange': market,
                                    'price': last_prices[pair]['last'],
                                    'label': pair.replace('_', '/').toUpperCase()
                                });
                            }
                        });
                    });
                    if(j + c_size > pairs.length) {
                        clearInterval(interval);
                    }
                    j += c_size;
                }, query_interval);
            });
        }).on('error', (e) => {
            console.error(e);
        });
    }

    poloniex() {
        const market = 'PLNX';
        const wsuri = 'wss://api.poloniex.com';
        const poloneix_connection = new autobahn.Connection({
            url: wsuri,
            realm: 'realm1'
        });
        const self = this;

        poloneix_connection.onopen = function(session) {
            session.subscribe('ticker', (args, kwargs) => {
                console.log(args);
                let delimiter = args[0].indexOf('_');
                self.emit('ticker', {
                    'exchange': market,
                    'price': args[1],
                    'label': (args[0].substr(delimiter + 1, args[0].length)
                        + '/' + args[0].substr(0, delimiter)
                    ).toUpperCase()
                });
            });
        };
        poloneix_connection.open();
    }

    livecoin() {
        const market = 'LIVE';
        https.get('https://api.livecoin.net/exchange/ticker', (res) => {
            let data = '';
            res.on('data', (d) => {
                data += d.toString();
            });
            res.on('end', () => {
                let res = JSON.parse(data);
                for(let i in res) {
                    if(!res.hasOwnProperty(i)) {
                        continue;
                    }
                    this.emit('ticker', {
                        'exchange': market,
                        'price': res[i]['last'],
                        'label': res[i]['symbol']
                    });
                }
            });
        }).on('error', (e) => {
            console.error(e);
        });
    }

    cex() {
        const market = 'CXIO';
        https.get('https://cex.io/api/tickers/USD/EUR/GBP/RUB/BTC/ETH/BCH', (res) => {
            let data = '';
            res.on('data', (d) => {
                data += d.toString();
            });
            res.on('end', () => {
                let res = JSON.parse(data);
                for(let i in res.data) {
                    if(!res.data.hasOwnProperty(i)) {
                        continue;
                    }
                    this.emit('ticker', {
                        'exchange': market,
                        'price': res.data[i]['last'],
                        'label': res.data[i]['pair'].replace(':', '/')
                    });
                }
            });
        }).on('error', (e) => {
            console.error(e);
        });
    }

    btrx() {
        const market = 'BTRX';
        bittrex.websockets.listen((data) => {
            if (data.M === 'updateSummaryState') {
                data.A.forEach((data_for) => {
                    data_for.Deltas.forEach((marketsDelta) => {
                        this.emit('ticker', {
                            'exchange': market,
                            'price': marketsDelta['Last'],
                            'label': marketsDelta['MarketName'].replace('-', '/')
                        });
                    });
                });
            }
        });
    }

    others() {
        const exclude_markets = ['BTRX', 'YOBT', 'CXIO', 'LIVE', 'PLNX',
            'CPIA', 'CCEX', 'BTER', 'HITB', 'LIQU']; //@todo soon
        //an empty account's api keys, please do not touch
        const api_credentials = {
            "apiKey"    : "bb3221608dfaacd1cef8d2a660ad880c",
            "apiSecret" : "bee2a83f04889d663c2bd53691f243a8"
        };

        const sc_socket = socketCluster.connect({
            hostname  : "sc-02.coinigy.com",
            port      : "443",
            secure    : "true"
        });

        sc_socket.on('connect', () => {
            sc_socket.on('error', (err) => {
                console.log(err);
            });

            sc_socket.emit('auth', api_credentials, (err, token) => {
                if (err || !token) {
                    console.log(err);
                    return;
                }

                const chanels = [];
                sc_socket.emit('exchanges', null, (err, data) => {
                    if (err) {
                        console.log(err);
                        return;
                    }

                    for(let i = 0; i < data[0].length; i++) {
                        let market_name = data[0][i]['exch_code'];
                        if(exclude_markets.indexOf(market_name) !== -1) {
                            continue;
                        }

                        sc_socket.emit('channels', market_name, (err, market_data) => {
                            if (err) {
                                console.log(err);
                                return;
                            }

                            for(let j = 0; j < market_data[0].length; j++) {
                                let chanel = market_data[0][j]['channel'];
                                if(chanel.indexOf('TRADE') === 0) {
                                    let sc_channel = sc_socket.subscribe(chanel);
                                    sc_channel.watch((data) => {
                                        this.emit('ticker', {
                                            'exchange': data['exchange'],
                                            'price': data['price'],
                                            'label': data['label']
                                        });
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

    run() {
        this.poloniex();
        this.btrx();
        this.others();
        setInterval(() => {
            this.yobit();
        }, 20000);
        setInterval(() => {
            this.livecoin();
            this.cex();
        }, 3000);
    }
}

module.exports = CryptoCollector;
