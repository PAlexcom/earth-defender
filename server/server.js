var server = require('http').createServer()
    , url = require('url')
    , WebSocketServer = require('ws').Server
    , wss = new WebSocketServer({ server: server })
    , express = require('express')
    , app = express()
    , port = 8888;
    , CLIENTS=[];

app.use(function (req, res) {
    res.send({ msg: "Earth Defender: Game Server" });
});

wss.on('connection', function connection(ws) {
    CLIENTS.push(ws);
    ws.on('message', function incoming(message) {
        console.log('received: %s', message);
    ws.on('disconnect', function(){
        console.log('user disconnected');
  });
    });

    ws.send('something');
});

server.on('request', app);
server.listen(port, function () { console.log('Listening on ' + server.address().port) });
