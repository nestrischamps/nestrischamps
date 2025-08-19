import './components/wizard.js';
import './components/capture.js';
import './components/multiview/index.js';

import QueryString from '/js/QueryString.js';
import BinaryFrame from '/js/BinaryFrame.js';
import Connection from '/js/connection.js';
import GameTracker from './GameTracker.js';

import loadPalettes from '/ocr/palettes.js';
import { sleep, timer } from './timer.js';
import { hasConfig, loadConfig } from './ConfigUtils.js';
import { getStream } from './MediaUtils.js';
import { CpuTetrisOCR } from './cpuTetrisOCR.js';
import { peerServerOptions } from '/views/constants.js';

import speak from '/views/tts.js';
import { CaptureDriver } from './CaptureDriver.js';
import { Player } from './Player.js';

const body = document.querySelector('body');
const notice = document.querySelector('div.notice');

const send_binary = QueryString.get('binary') !== '0';

function resetNotice() {
	notice.classList.remove('error', 'warning');
	notice.classList.add('is-hidden');
	notice.textContent = '';
	body.prepend(notice);
}

let connection;
let peer = null;
let view_peer_id = null;
let is_player = false;
let view_meta = null;

const API = {
	message(msg) {
		if (QueryString.get('tts') === '1') {
			speak(msg);
		}
	},

	setViewPeerId(_view_peer_id) {
		view_peer_id = _view_peer_id;
	},

	makePlayer(player_index, _view_meta) {
		// producer is player, share video
		is_player = true;
		view_meta = _view_meta;

		// if (roomIFrame) {
		// 	loadRoomView();
		// }

		// startSharingVideoFeed();
	},

	dropPlayer() {
		is_player = false;
		view_meta = null;
		// producer is no longer player
		stopSharingVideoFeed();
	},

	setVdoNinjaURL(url) {
		if (url) {
			document.querySelector('#vdo_ninja_url').textContent = url;

			url = new URL(url);

			const streamId =
				url.searchParams.get('view') || u.searchParams.get('push');

			url.searchParams.delete('view');
			url.searchParams.set('push', streamId);
			url.searchParams.set('webcam', 1);
			url.searchParams.set('audiodevice', 0);
			url.searchParams.set('autostart', 1);

			vdo_ninja.checked = true;
			document.querySelector('#vdoninja').src = url.toString();
		}
	},
};

function connect() {
	if (connection) {
		connection.close();
	}

	console.log('Creating Connection');
	connection = new Connection('ws://localhost:5001/ws/room/producer2/PLAYER1');

	connection.onMessage = function (frame) {
		try {
			const [method, ...args] = frame;

			if (API.hasOwnProperty(method)) {
				API[method](...args);
			} else {
				console.log(`Command ${method} received but not supported`);
			}
		} catch (e) {
			console.log(`Could not process command ${frame[0]}`);
			console.error(e);
		}
	};

	connection.onKicked = function (reason) {
		resetNotice();
		notice.classList.add('error');
		notice.textContent = `WARNING! The connection has been kicked because [${reason}]. The page will NOT attempt to reconnect.`;
		notice.classList.remove('is-hidden');
	};

	connection.onBreak = function () {
		resetNotice();
		notice.classList.add('warning');
		notice.textContent = `WARNING! The page is disconnected. It will try to reconnect automatically.`;
		notice.classList.remove('is-hidden');
	};

	connection.onResume = resetNotice;

	connection.onInit = () => {
		if (peer) {
			peer.removeAllListeners();
			peer.destroy();
			peer = null;
		}

		peer = new Peer(connection.id, peerServerOptions);

		peer.on('open', err => {
			console.log(Date.now(), 'peer opened', peer.id);
			//startSharingVideoFeed();
		});

		peer.on('error', err => {
			console.log(`Peer error: ${err.message}`);
			peer.retryTO = clearTimeout(peer.retryTO); // there should only be one retry scheduled
			// peer.retryTO = setTimeout(startSharingVideoFeed, 1500); // we assume this will succeed at some point?? 😰😅
		});
	};

	return connection;
}

function loadCaptureUI() {
	const capture = document.createElement('ntc-capture');

	capture.id = 'capture';
	document.body.prepend(capture);

	return capture;
}

async function initEverDriveCapture(config, tabToOpen) {
	removeCalibrationTab();
	initCaptureFromEverdrive(config.frame_rate); // TODO
}

async function initMultiViewerCapture(config) {
	const capture = document.createElement('ntc-multiview');

	capture.id = 'capture';
	document.body.prepend(capture);

	const driver = new CaptureDriver(config);

	let playerNum = (value => {
		return /^[123]\d+$/.test(value) ? parseInt(value, 10) : 1;
	})(QueryString.get('player_start'));

	for (const playerConfig of config.players) {
		const player = new Player(playerNum, playerConfig);
		driver.addPlayer(player);
	}

	capture.setDriver(driver);

	return capture;
}

async function initOCRCapture(config, tabToOpen) {
	console.log('initOCRCapture');

	const driver = new CaptureDriver(config);
	const player = new Player(config);

	driver.addCapture(player);

	const ocr = new CpuTetrisOCR(config);
	const gameTracker = new GameTracker(config);

	let start_time = Date.now();
	let last_frame = { field: [] };

	const capture = loadCaptureUI();
	capture.setOCR(ocr);
	capture.setGameTracker(gameTracker);
	capture.showTab(tabToOpen);

	ocr.addEventListener('frame', data => {
		gameTracker.processFrame(data.detail);
	});

	connection = connect();

	gameTracker.addEventListener('frame', ({ detail: data }) => {
		data.game_type = config.game_type ?? BinaryFrame.GAME_TYPE.CLASSIC;
		data.ctime = Date.now() - start_time;

		performance.clearMarks();
		performance.clearMeasures();

		// delete data fields which are never meant to be sent over the wire
		delete data.color1;
		delete data.color2;
		delete data.color3;
		delete data.gym_pause_active;
		delete data.raw;

		// only send frame if changed
		check_equal: do {
			for (let key in data) {
				if (key == 'ctime') continue;
				if (key == 'field') {
					if (!data.field.every((v, i) => last_frame.field[i] === v)) {
						break check_equal;
					}
				} else if (data[key] != last_frame[key]) {
					break check_equal;
				}
			}

			// all fields equal, do a sanity check on time
			if (data.ctime - last_frame.ctime >= 250) break; // max 1 in 15 frames (4fps)

			// no need to send frame
			return;
		} while (false);

		last_frame = data;

		if (send_binary) {
			connection.send(BinaryFrame.encode(data));
		} else {
			// convert Uint8Array to normal array so it can be json-encoded properly
			data.field = [...data.field];
			connection.send(data);
		}
	});
}

async function initFromConfig(tabToOpen) {
	const config = await loadConfig();

	if (config.device_id === 'everdrive') {
		initEverDriveCapture(config, 'ocr_results');
	} else if (config.mode === 'multiviewer') {
		initMultiViewerCapture(config);
	} else {
		initOCRCapture(config, tabToOpen);
	}
}

(async function main() {
	console.log('main');

	// unfortunate bootstrap delay, but makes everything else simpler later on
	await timer.init();

	// load external assets - could parrallelize
	const palettes = await loadPalettes();

	if (hasConfig()) {
		console.log('has config');
		initFromConfig('ocr_results');
	} else {
		const wizard = document.createElement('ntc-wizard');
		document.body.prepend(wizard);

		await new Promise(resolve => {
			wizard.addEventListener('config-ready', resolve, { once: true });
		});

		await sleep(0);
		wizard.remove();
		await sleep(0);

		initFromConfig('calibration');
	}
})();
