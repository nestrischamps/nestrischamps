import QueryString from '/js/QueryString.js';
import BinaryFrame from '/js/BinaryFrame.js';
import Connection from '/js/connection.js';

import { peerServerOptions } from '/js/peerjsOptions.js';

const SEND_BINARY = QueryString.get('binary') !== '0';
const HEART_BEAT_TIMEOUT = 1000;

export class Player extends EventTarget {
	#startTime;
	#lastFrame;
	#connection = null;
	#sendBinary = SEND_BINARY;
	#peer;
	supportsRemoteCalibration = false;

	constructor(config, num = null) {
		super();

		this.num = num;
		this.config = config;

		this.#startTime = Date.now();
		this.#lastFrame = { field: [] };

		this.is_player = false;
		this.notice = document.createElement('div');

		this.API = {
			message: msg => {
				this.dispatchEvent(
					new CustomEvent('chat_message', {
						detail: msg,
					})
				);
			},

			setViewPeerId: _view_peer_id => {
				this.view_peer_id = _view_peer_id;
			},

			makePlayer: (player_index, view_meta) => {
				this.is_player = true;
				this.view_meta = view_meta;
				this.dispatchEvent(
					new CustomEvent('make_player', {
						detail: { player_index, view_meta },
					})
				);
			},

			dropPlayer() {
				this.is_player = false;
				this.view_meta = null;
				this.dispatchEvent(new CustomEvent('drop_player'));
			},

			setVdoNinjaURL: () => {},
		};
	}

	// process a single frame from source device, be it a video or a memory grab
	processFrame() {}

	// handle the processed frame event from game tracker and send to server
	handleFrame = ({ detail: data }) => {
		if (!this.#connection) return;
		if (!data) return;

		const localData = { ...data };

		localData.game_type =
			this.config.game_type ?? BinaryFrame.GAME_TYPE.CLASSIC;
		localData.ctime = Date.now() - this.#startTime;

		// delete data fields which are never meant to be sent over the wire
		delete localData.color1;
		delete localData.color2;
		delete localData.color3;
		delete localData.gym_pause_active;
		delete localData.raw;

		// only send frame if changed
		check_equal: do {
			for (let key in localData) {
				if (key == 'ctime') continue;
				if (key.startsWith('_')) continue; // private field - never sent, so we don't compare it
				if (key == 'field') {
					if (
						!localData.field.every((v, i) => this.#lastFrame.field[i] === v)
					) {
						break check_equal;
					}
				} else if (localData[key] != this.#lastFrame[key]) {
					break check_equal;
				}
			}

			// all fields equal, do a sanity check on time
			if (localData.ctime - this.#lastFrame.ctime >= HEART_BEAT_TIMEOUT) break; // even if there's no change, send a "heartbeat frame" at least every HEART_BEAT_TIMEOUT ms

			// no need to send frame
			return;
		} while (false);

		this.#lastFrame = localData;

		if (this.#sendBinary) {
			this.#connection?.send(BinaryFrame.encode(localData));
		} else {
			// convert Uint8Array to normal array so it can be json-encoded properly
			localData.field = [...localData.field];
			this.#connection?.send(localData);
		}
	};

	connect() {
		if (this.#connection) {
			this.#connection.close();
		}

		console.log('Creating Connection');

		const connUrlParams = new URLSearchParams();

		if (this.supportsRemoteCalibration) {
			connUrlParams.set('_remote_calibration', 1);
		}

		if (this.num === null) {
			this.#connection = new Connection(null, connUrlParams);
		} else {
			// multiviewer mode, we connect by static player secret
			const url = new URL(location);
			url.protocol = url.protocol.match(/^https/i) ? 'wss:' : 'ws:';
			url.pathname = `/ws${url.pathname}`.replace(
				/(\/+)?$/,
				`/PLAYER${this.num}`
			);

			console.log(`Using custom url: ${url.toString()}`);

			this.#connection = new Connection(url.toString(), connUrlParams);
		}

		this.#connection.onMessage = frame => {
			try {
				const [method, ...args] = frame;

				if (this.API.hasOwnProperty(method)) {
					this.API[method](...args);
				} else {
					console.log(`Command ${method} received but not supported`);
				}
			} catch (e) {
				console.log(`Could not process command ${frame[0]}`);
				console.error(e);
			}
		};

		this.#connection.onKicked = reason => {
			this.resetNotice();
			this.notice.classList.add('error');
			this.notice.textContent = `WARNING! The connection has been kicked because [${reason}]. The page will NOT attempt to reconnect.`;
			this.notice.classList.remove('is-hidden');
		};

		this.#connection.onBreak = () => {
			this.resetNotice();
			this.notice.classList.add('warning');
			this.notice.textContent = `WARNING! The page is disconnected. It will try to reconnect automatically.`;
			this.notice.classList.remove('is-hidden');
		};

		this.#connection.onResume = this.resetNotice;

		this.#connection.onInit = () => {
			if (this.#peer) {
				this.#peer.removeAllListeners();
				this.#peer.destroy();
				this.#peer = null;
			}
			this.#peer = new Peer(this.#connection.id, peerServerOptions);
			this.#peer.on('open', err => {
				console.log(Date.now(), 'peer opened', this.#peer.id);
				this.dispatchEvent(new CustomEvent('peer_open'));
			});
			this.#peer.on('error', err => {
				console.log(`Peer error: ${err.message}`);
				this.#peer.retryTO = clearTimeout(this.#peer.retryTO); // there should only be one retry scheduled
				// this.#peer.retryTO = setTimeout(startSharingVideoFeed, 1500); // we assume this will succeed at some point?? 😰😅
			});
		};

		return this.#connection;
	}

	getPeer() {
		return this.#peer;
	}

	getViewPeerId() {
		return this.view_peer_id;
	}

	resetNotice = () => {};

	sendReady = (ready = false) => {
		this.#connection?.send(['setReady', !!ready]);
	};

	sendVdoNinjaUrl = url => {
		this.#connection?.send(['setVdoNinjaURL', url]);
	};
}
