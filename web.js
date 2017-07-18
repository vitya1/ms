var fs = require('fs');
var express = require('express');
var app = express();
var hbs = require('express-handlebars');
var robots = require('express-robots');
var server = require('http').createServer(app);
var io = require('socket.io')(server);


app.engine('hbs', hbs({extname: 'hbs'}));
app.set('views', (__dirname + '/views'));
app.set('view engine', 'hbs');

app.use(express.static(__dirname + '/public'));
app.use('/bower_components',  express.static(__dirname + '/bower_components'));
app.use(robots({UserAgent: '*', Disallow: '/'}));

app.get('/', function (req, res) {
    res.render('index');
});

app.use(function(req, res) {
    res.status(404);
    res.send('404 error :(');
});

var clients = [];
io.on('connection', function (socket) {
    clients.push(socket);

    socket.emit('alert', { data: 'ETH' });
    socket.on('choose_filter', function (data) {
        console.log(data);
    });
});

server.listen(3000, function () {
    console.log('web server launched')
});



/*


if(price below than last 12 hours, day, 2 days, 3 days) {
    say it
}


 */
