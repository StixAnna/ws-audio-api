var https = require('https');
var fs = require('fs');
var WebSocket = require('ws'); // Import WebSocket
var WebSocketServer = WebSocket.Server;

var wsPort = 5000;

var httpsServer = https.createServer({
    key: fs.readFileSync('key.pem', 'utf8'),
    cert: fs.readFileSync('cert.pem', 'utf8')
}).listen(wsPort);

var wss = new WebSocketServer({ server: httpsServer });

wss.on('connection', function (ws, req) {
    console.log('Client connected:', req.headers['sec-websocket-key']);

    ws.on('message', function incoming(message) {
        // console.log('Received message:', message);

        // Broadcast to everyone else.
        wss.clients.forEach(function each(client) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message, { binary: true }, function (err) {
                    if (err) {
                        console.log('Error sending message:', err);
                    }
                });
            }
        });
    });

    ws.on('close', function () {
        console.log('Client disconnected:', req.headers['sec-websocket-key']);
    });
});

console.log('Listening on port:', wsPort);
