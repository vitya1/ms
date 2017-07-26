const fs = require('fs');
const express = require('express');
const app = express();
const hbs = require('express-handlebars');
const robots = require('express-robots');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const net = require('net');
const os = require('os');
const uniqid = require('uniqid');

"use strict";

app.engine('hbs', hbs({extname: 'hbs'}));
app.set('views', (__dirname + '/views'));
app.set('view engine', 'hbs');

app.use(express.static(__dirname + '/public'));
app.use('/bower_components',  express.static(__dirname + '/bower_components'));
app.use('/public',  express.static(__dirname + '/public'));
app.use(robots({UserAgent: '*', Disallow: '/'}));

app.get('/', function (req, res) {
    res.render('index', {url: req.get('host')});
});

app.use(function(req, res) {
    res.status(404);
    res.send('404 error :(');
});

const clients = new Map();
io.on('connection', socket => {
    socket.client_id = uniqid();
    socket.filter = {};
    clients.set(uniqid, socket);

    socket.on('choose_filter', data => {
        if(data.hasOwnProperty('period')) {
            socket.filter = {'lowest_at': parseFloat(data['period'])};
        }
        console.log(data);
    });

    socket.on('disconnect', () => {
        clients.delete(socket.client_id);
    });
});

server.listen(3001);


const socket_path = __dirname + '/pipe.sock';
let socket_client = net.createConnection(socket_path);

socket_client.on('error', err => {
    console.log(err);
}).on('data', data => {
    data.toString().split(os.EOL).forEach(s => {
        if(s === '') {
            return;
        }
        let arr = JSON.parse(s);
        console.log(arr);
        for(let client of clients.values()) {
            if(client.filter.hasOwnProperty('lowest_at')
                &&  arr[5].indexOf(client.filter['lowest_at']) !== -1) {
                client.emit('alert', arr);
            }
        }
    });

});
