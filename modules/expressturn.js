// modules/expressturn.js
// Paid for Turn server
//
// Credentials are dynamically generated with 2-days expiry
// this should work well for heroku which restarts the app daily

import fs from 'fs';
import crypto from 'crypto';
import { shuffle } from '../public/views/utils.js';
import _ from 'lodash';

const TTL = 86400 * 2; // 2 days

// Generate TURN credentials
// see https://www.expressturn.com/webrtc-secret-key-examples
function generateTurnCredentials(username) {
	// expiry timestamp
	const timestamp = Math.floor(Date.now() / 1000) + TTL;

	// Combine timestamp with username
	const turnUsername = `${timestamp}:${username}`;

	// Generate password using HMAC-SHA1 and encode in Base64
	const password = crypto
		.createHmac('sha1', process.env.EXPRESSTURN_SECRET_KEY)
		.update(turnUsername)
		.digest('base64');

	return [turnUsername, password];
}

if (process.env.EXPRESSTURN_SECRET_KEY && process.env.EXPRESSTURN_USERNAME) {
	// Generate and display credentials
	const [username, credential] = generateTurnCredentials(
		process.env.EXPRESSTURN_USERNAME
	);

	// expressturn has 17 relay servers, we will randomly pick 3 to use
	const serverNums = shuffle(
		Array(17)
			.fill(0)
			.map((_, idx) => idx + 1)
	).slice(0, 3);

	// one stun entry first
	const iceServers = [
		{
			urls: serverNums.map(
				serverNum => `stun:relay${serverNum}.expressturn.com:3478`
			),
		},
	];

	serverNums.forEach(serverNum => {
		iceServers.push({
			urls: [
				`turns:relay${serverNum}.expressturn.com:443`,
				`turn:relay${serverNum}.expressturn.com:3478?transport=udp`,
				`turn:relay${serverNum}.expressturn.com:3478?transport=tcp`,
			],
			username,
			credential,
		});
	});

	const peerjsServerOptions = {
		host: '0.peerjs.com',
		path: '/',
		port: 443,
		secure: true,
		config: {
			iceServers,
			// iceTransportPolicy: 'relay', // force turn for testing purposes
		},
	};

	fs.writeFileSync(
		'public/js/peerjsOptions.js',
		`export const peerServerOptions = ${JSON.stringify(
			peerjsServerOptions,
			null,
			2
		)};\n`
	);

	// Formatted output using template literal
	console.log(`TURN Credentials Generated
----------------------------------------
Username: ${username}
Password: ${credential}
TTL     : ${TTL} seconds
----------------------------------------`);
}
