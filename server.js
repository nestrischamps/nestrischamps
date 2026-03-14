import { WebSocketServer } from 'ws';
import { Server } from 'http';
import { createServer } from 'https';
import { readFileSync } from 'fs';

import './modules/expressturn.js'; // conditionnaly sets up peerjs server options

import app from './modules/app.js';
import config from './modules/config.js';

let server;

if (config.get('server.tls_key') && config.get('server.tls_cert')) {
	const options = {
		key: readFileSync(config.get('server.tls_key')),
		cert: readFileSync(config.get('server.tls_cert')),
	};
	server = createServer(options, app);
} else if (config.get('server.tls_key') || config.get('server.tls_cert')) {
	throw new Error('HTTPS requires both TLS_KEY and TLS_CERT');
} else {
	server = Server(app);
}

const wss = new WebSocketServer({
	clientTracking: false,
	noServer: true,
});

import websocketInitializer from './routes/websocket.js';

websocketInitializer(server, wss);

server.listen(config.get('server.port'));
