const fs = require('fs');
const express = require('express');
const app = express();
const hbs = require('express-handlebars');
const robots = require('express-robots');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const net = require('net');
const os = require('os');

"use strict";

app.engine('hbs', hbs({extname: 'hbs'}));
app.set('views', (__dirname + '/views'));
app.set('view engine', 'hbs');

app.use(express.static(__dirname + '/public'));
app.use('/bower_components',  express.static(__dirname + '/bower_components'));
app.use('/sounds',  express.static(__dirname + '/sounds'));
app.use(robots({UserAgent: '*', Disallow: '/'}));

app.get('/', function (req, res) {
    res.render('index');
});

app.use(function(req, res) {
    res.status(404);
    res.send('404 error :(');
});

//@todo change to Map()
const clients = [];
io.on('connection', socket => {
    socket.client_id = clients.length;
    clients.push(socket);

    socket.on('choose_filter', data => {
        console.log(data);
    });

    socket.on('disconnect', () => {
        //delete client
    });
});

server.listen(3000);


const socket_path = __dirname + '/pipe.sock';
const socket_client = net.createConnection(socket_path);

socket_client.on('error', err => {
    console.log(err);
}).on('data', data => {
    data.toString().split(os.EOL).forEach(s => {
        if(s === '') {
            return;
        }
        let arr = JSON.parse(s);
        console.log(arr);
        for(let i = 0; i < clients.length; i++) {
            clients[i].emit('alert', arr);
        }
    });

});
