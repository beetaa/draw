'use strict';

var express = require('express'),
    redis = require('redis'),
    app = express();

app.use(express.static(__dirname + '/public'));

var server = app.listen(3000, function() {
    console.log('Listening on port %d', server.address().port);
});

var io = require('socket.io').listen(server);

app.get('/', function index(req, res){
    res.sendfile(__dirname + '/public/canvas.html');
});

var redisclient = redis.createClient();

redisclient.on("error", function (err) {
    console.log("redis error " + err);
});

var userIdsToSocketIds = {};

io.sockets.on('connection', function (socket) {
    console.log('user connected to socket', socket.id);

    socket.on('roomConnection', function(roomId, userId){
        console.log('user', userId, 'connected to room', roomId);

        userIdsToSocketIds[userId] = socket.id;

        //will only listen to events targeting this room;
        var eventKey = 'message-' + roomId;
        var historyKey = 'messages-' + roomId;
        var mouseEventKey = 'mouse-' + roomId;
        var roomConnectionKey = 'userConnected-' + roomId;
        var roomConnectionHandshakeKey = 'handshakeConnection-' + roomId;

        //inform other users that you have joined the room
        socket.broadcast.emit(roomConnectionKey, userId);

        //other users will inform you of thier presence in the room
        socket.on(roomConnectionHandshakeKey, function(handshake){
            console.log('handshake:', handshake);

            var socketId = userIdsToSocketIds[handshake.initiator];
            if(socketId){
                io.sockets.socket(socketId).emit(roomConnectionHandshakeKey, handshake);
            }
            else{
                console.log('couldnt find socket id for hand shake with', userId);
            }
        });

        //when user connects, retrieve all previously emitted messages from redis
        //and send to user
        redisclient.lrange(historyKey, 0, -1, function(err, items){
            if(err){
                console.log("error retrieving messages from redis: " + err);
            }
            else{
                socket.emit(historyKey, items);
            }
        });

        //user has emmited an event - add to history and send broad to other users
        socket.on(eventKey, function (data) {
            console.log('message from', data.userId, '. data', data);

            //if screen was cleared, flush history - no longer needed
            if(data.type === 'clear'){
                console.log('clearing REDIS');
                redisclient.del(historyKey);
            }
            //add message to history
            redisclient.rpush(historyKey, JSON.stringify(data));

            // send to all clients except sender
            socket.broadcast.emit(eventKey, data);
        });

        //track mouse movement
        socket.on(mouseEventKey, function (data) {
           socket.broadcast.emit(mouseEventKey, data);
        });
    });

    socket.on('disconnect', function () {
        //TODO: flush redis when room is empty?
        // socket.broadcast.emit('user disconnected');
    });
});
