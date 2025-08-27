import Connection from '/js/connection.js';
import QueryString from '/js/QueryString.js';

import { peerServerOptions } from '/views/constants.js';

import { getSerializableConfigCopy } from '/producer/ConfigUtils.js';
import { sleep } from '/producer/timer.js';
import { CaptureDriver } from '/producer/CaptureDriver.js';
import { CpuTetrisOCR } from '/producer/cpuTetrisOCR.js';

const dom = {
	roomid: document.querySelector('#roomid'),
	producer_count: document.querySelector('#producer_count'),
	bestof: document.querySelector('#bestof'),
	setHideProfileCardOnNextGame: document.querySelector(
		'#setHideProfileCardOnNextGame'
	),
	count_down: document.querySelector('#count_down'),
	clear_field_overlays: document.querySelector('#clear_field_overlays'),
	clear_victories: document.querySelector('#clear_victories'),
	show_runways: document.querySelector('#show_runways'),
	hide_runways: document.querySelector('#hide_runways'),
	focus_none: document.querySelector('#focus_none'),
	player_link: document.querySelector('#player_link'),
	show_match_controls: document.querySelector('#show_match_controls'),
	show_profile_cards_controls: document.querySelector(
		'#show_profile_cards_controls'
	),
	allow_autojoin: document.querySelector('#allow_autojoin'),
	add_player: document.querySelector('#add_player'),
	curtain_logo_url: document.querySelector('#curtain_logo_url'),
};

const MAX_BEST_OF = 13;

const apiHandler = {
	get(target, prop, receiver) {
		return function (...args) {
			connection && connection.send([prop, ...args]);
		};
	},
};

const remoteAPI = new Proxy({}, apiHandler);

const players = [];
let room_data;
let connection;

function getProducer(pid) {
	return room_data.producers.find(producer => producer.id === pid);
}

class Player {
	constructor(idx, dom) {
		this.dom = dom;

		this.setIndex(idx);

		if (QueryString.get('rcal') !== '1')
			this.dom.remote_calibration_btn.remove();

		this.victories = 0;
		this.bestof = -1;

		// link dom events
		this.dom.name.onchange = this.dom.name.onkeyup = _.debounce(() => {
			remoteAPI.setDisplayName(this.idx, this.dom.name.value.trim());
		}, 750);

		this.dom.avatar_url.onchange = this.dom.avatar_url.onkeyup = _.debounce(
			() => {
				const avatar_url = this.dom.avatar_url.value.trim();

				remoteAPI.setProfileImageURL(this.idx, avatar_url);
				this.dom.avatar_img.src = avatar_url;
			},
			750
		);

		this.dom.country_code_select.onchange = () => {
			const country_code = this.dom.country_code_select.value;

			remoteAPI.setCountryCode(this.idx, country_code);
			this.setFlag(country_code);
		};

		this.dom.producers.onchange = () =>
			this._pickProducer(this.dom.producers.value);

		if (this.dom.users) {
			this.dom.users.onchange = () => {
				if (!this.dom.users.value) return;

				this._setPlayerOnBehalfOfUser(this.dom.users.value);
			};
		}

		let copying = false;
		this.dom.vdo_ninja_url.querySelector('svg.action.clipboard-copy').onclick =
			async () => {
				if (copying) return;
				copying = true;

				const icon = this.dom.vdo_ninja_url.querySelector(
					'svg.action.clipboard-copy'
				);

				[...this.dom.vdo_ninja_url.querySelectorAll('svg.result')].forEach(
					icon => (icon.style.display = 'none')
				);

				try {
					await navigator.clipboard.writeText(
						this.dom.vdo_ninja_url.querySelector('a').href
					);
					icon.style.display = 'none';
					this.dom.vdo_ninja_url.querySelector('svg.success').style.display =
						'inline';
				} catch (err) {
					icon.display = 'none';
					this.dom.vdo_ninja_url.querySelector('svg.failure').style.display =
						'inline';
					console.error('Umable to write to clipboard');
				}

				setTimeout(() => {
					[...this.dom.vdo_ninja_url.querySelectorAll('svg.result')].forEach(
						icon => (icon.style.display = 'none')
					);
					icon.style.display = 'inline';
					copying = false;
				}, 650);
			};

		let playing;
		this.dom.vdo_ninja_url.querySelector('svg.action.vdo-play').onclick =
			async () => {
				if (playing) return;
				playing = true;

				const icon = this.dom.vdo_ninja_url.querySelector(
					'svg.action.vdo-play'
				);

				icon.style.display = 'none';

				const iframe = document.createElement('iframe');
				iframe.setAttribute(
					'allow',
					'autoplay;camera;microphone;fullscreen;picture-in-picture;display-capture;midi;geolocation;gyroscope;'
				);
				iframe.src = this.dom.vdo_ninja_url.querySelector('a').href;

				this.dom.images.append(iframe);

				setTimeout(() => {
					iframe.remove();
					icon.style.display = 'inline';
					playing = false;
				}, 30000);
			};

		this.dom.win_btn.onclick = () => {
			remoteAPI.setWinner(this.idx);
		};

		this.dom.game_over_btn.onclick = () => {
			remoteAPI.setGameOver(this.idx);
		};

		this.dom.cancel_game_over_btn.onclick = () => {
			remoteAPI.cancelGameOver(this.idx);
		};

		this.dom.remove_btn.onclick = () => {
			remoteAPI.removePlayer(this.idx);
		};

		this.dom.camera_restart_btn.onclick = () => {
			remoteAPI.restartCamera(this.idx);
		};

		this.dom.camera_mirror_btn.onclick = () => {
			remoteAPI.mirrorCamera(this.idx);
		};

		this.dom.focus_player_btn.onclick = () => {
			remoteAPI.focusPlayer(this.idx);
		};

		this.dom.remote_calibration_btn.onclick = async () => {
			let overlay = document.createElement('iframe');

			// Style it to cover 100% of the viewport
			Object.assign(overlay.style, {
				position: 'fixed',
				top: '0',
				left: '0',
				width: '100vw',
				height: '100vh',
				backgroundColor: 'rgba(0, 0, 0, 0.8)', // example semi-transparent background
				zIndex: '9999', // make sure it's on top
				overflowY: 'auto', // adds scroll only when needed
				overflowX: 'hidden', // optional: prevent horizontal scroll
				margin: 0,
				padding: 0,
				border: 0,
			});

			overlay.src = '/remote_calibration';
			document.body.appendChild(overlay);

			overlay.addEventListener('load', () => {
				const clearPeer = () => {
					if (!this.peer) return;
					// this.peer.removeAllListeners();
					this.peer.destroy();
					this.peer = null;
				};

				const clearAll = () => {
					// TODO destroy processingpipeline (driver + ocr + calibration_ui)
					// overlay.removeAllListeners();
					// closeOnly.removeAllListeners();
					// saveAndClose.removeAllListeners();
					overlay.remove();
					overlay = null;
					this.dataConnection = null;
					if (driver) driver.destroy();
					clearPeer();
				};

				const doc = overlay.contentDocument || overlay.contentWindow.document;
				const closeOnly = doc.getElementById('close_only');
				const saveAndClose = doc.getElementById('save_and_close');

				// set up ui
				doc.getElementById('name').innerText = this.dom.name.value;

				const saveConfig = names => {
					let config = getSerializableConfigCopy(
						this.dataConnection.metadata.config
					);

					// cleanup to send just the crop
					for (const [name, task] of Object.entries(config.tasks)) {
						config.tasks[name] = { crop: task.crop };
					}

					if (names) {
						// only send the config being changed
						config = {
							tasks: names.reduce((acc, name) => {
								acc[name] = { crop: config.tasks[name].crop };
								return acc;
							}, {}),
						};
					}

					this.dataConnection.send({ config });
				};

				closeOnly.addEventListener('click', clearAll);
				saveAndClose.addEventListener('click', async () => {
					saveConfig();
					clearAll();
				});

				const calibration = doc.getElementById('calibration');

				if (this.peer) {
					clearPeer();
				}

				const peerid = `${connection.id}-${this.idx}`;
				const peer = (this.peer = new Peer(peerid, peerServerOptions));

				let driver;
				let ocr;
				let srcCanvas;
				let srcCtx;

				peer.on('connection', async dataConnection => {
					this.dataConnection = dataConnection;

					const { config, video } = dataConnection.metadata;
					config.save = function (name) {
						saveConfig(name);
					};

					ocr = new CpuTetrisOCR(config);

					calibration.setOCR(ocr);

					srcCanvas = document.createElement('canvas');
					srcCanvas.width = video.width;
					srcCanvas.height = video.height;

					srcCtx = srcCanvas.getContext('2d');

					// receive new frames (VERY low frame rate)
					dataConnection.on('data', async data => {
						if (!data.webp) return;

						const blob = new Blob([data.webp], { type: 'image/webp' });
						const bitmap = await createImageBitmap(blob);
						srcCtx.drawImage(bitmap, 0, 0);
					});

					const stream = srcCanvas.captureStream(10);

					driver = new CaptureDriver(config, stream);
					driver.addPlayer({
						processVideoFrame(frame) {
							ocr.processVideoFrame(frame);
						},
					});
				});

				peer.on('open', id => {
					remoteAPI.requestRemoteCalibration(this.idx, peerid);
				});
			});
		};
	}

	setIndex(idx) {
		this.idx = idx;
		this.dom.num.textContent = idx + 1;
	}

	setFlag(country_code) {
		this.dom.country_code_img.src =
			this.dom.country_code_img.dataset.url.replace('{code}', country_code);
	}

	setVdoNinjaURL(url) {
		if (!url) {
			this.dom.vdo_ninja_url.querySelector('span').replaceChildren();
			this.dom.vdo_ninja_url.style.display = 'none';
			return;
		}

		const u = new URL(url);

		const streamId = u.searchParams.get('view') || u.searchParams.get('push'); // just in case someone passed the push url

		u.searchParams.delete('push');
		u.searchParams.set('view', streamId);
		u.searchParams.set('cover', 1);
		u.searchParams.set('cleanviewer', 1);
		u.searchParams.set('cleanoutput', 1);
		u.searchParams.set('transparent', 1);
		u.searchParams.set('autostart', 1);

		const full_url = u.toString();

		const a = document.createElement('a');
		a.href = full_url;
		a.target = '_blank';
		a.textContent = url.replace(/^https?:\/\//, '').replace(/&.+$/, '');

		this.dom.vdo_ninja_url.querySelector('span').replaceChildren(a);
		this.dom.vdo_ninja_url.style.display = 'block';
	}

	setProducers(producers) {
		this.dom.producers.innerHTML = '';

		const option = document.createElement('option');
		option.value = '';
		option.textContent = '-';
		this.dom.producers.appendChild(option);

		producers.forEach(producer => {
			const option = document.createElement('option');
			option.value = producer.id;
			option.textContent = producer.login;

			this.dom.producers.appendChild(option);
		});
	}

	setBestOf(n) {
		if (this.bestof === n) return;

		this.bestof = n;

		this.dom.victories.innerHTML = '';

		const heart = '&#338';
		const num_heart = Math.ceil(n / 2);
		const items = ['-', ...Array(num_heart).fill(heart)];

		items.forEach((content, idx) => {
			const span = document.createElement('span');

			span.innerHTML = content;
			span.onclick = () => this._pickVictories(idx);

			this.dom.victories.append(span);
		});
	}

	_pickProducer(pid) {
		remoteAPI.setPlayer(this.idx, pid);
	}

	_setPlayerOnBehalfOfUser(pid) {
		remoteAPI.setPlayerOnBehalfOfUser(this.idx, pid);
	}

	setProducer(pid) {
		const selected_pid = this.dom.producers.value;

		if (selected_pid === pid) return;

		const producer = getProducer(pid);

		this.dom.producers.value = pid;

		if (!producer) return;

		this.dom.name.value = producer.display_name;
		this.dom.avatar_url.value = producer.profile_image_url;
		this.dom.avatar_img.src = producer.profile_image_url;
	}

	_pickVictories(n) {
		remoteAPI.setVictories(this.idx, n);
	}

	setVictories(n) {
		this.victories = n;

		this.dom.victories.querySelectorAll('span').forEach((span, idx) => {
			if (idx && idx <= (n || 0)) {
				span.classList.add('win');
			} else {
				span.classList.remove('win');
			}
		});
	}

	setState(state) {
		this.setVictories(state.victories);
		this.setProducer(state.id);

		this.dom.name.value = state.display_name;
		this.dom.avatar_url.value = state.profile_image_url;
		this.dom.avatar_img.src = state.profile_image_url;

		if (state.vdo_ninja_url) {
			this.setVdoNinjaURL(state.vdo_ninja_url);
		}

		this.dom.country_code_select.value = state.country_code;
		this.setFlag(state.country_code);
	}
}

function setBestOfOptions(n, selected) {
	const select = dom.bestof;

	for (; n >= 3; n -= 2) {
		const option = document.createElement('option');
		option.value = n;
		option.textContent = n;

		if (n === selected) {
			option.setAttribute('selected', 'selected');
		}

		select.prepend(option);
	}
}

function setState(_room_data) {
	room_data = _room_data;

	// room stats
	room_data.producers.sort((a, b) => a < b);

	dom.curtain_logo_url.value = room_data.curtain_logo;
	dom.bestof.value = room_data.bestof;
	dom.producer_count.textContent = room_data.producers.length;

	// synchronize with remote players
	while (players.length > room_data.players.length) {
		players.pop().dom.root.remove();
	}

	for (let idx = players.length; idx < room_data.players.length; idx++) {
		addPlayer();
	}

	players.forEach((player, idx) => {
		player.setIndex(idx);
		player.setProducers(room_data.producers);
		player.setBestOf(room_data.bestof);
		player.setState(room_data.players[idx]);
	});

	dom.show_match_controls.style.display = room_data.concurrent_2_matches
		? null
		: 'none';

	if (room_data.concurrent_2_matches) {
		switch (room_data.selected_match) {
			case 0:
				dom.show_match_controls.querySelector('#match_1').checked = true;
				break;
			case 1:
				dom.show_match_controls.querySelector('#match_2').checked = true;
				break;
			default:
				dom.show_match_controls.querySelector('#match_both').checked = true;
				break;
		}
	}

	dom.show_profile_cards_controls.querySelector('.matches').style.display =
		room_data.concurrent_2_matches ? null : 'none';

	dom.allow_autojoin.checked = !!room_data.autojoin;
}

function addPlayer() {
	const players_node = document.querySelector('#players');
	const player_template = document.getElementById('player');
	const player_node = document
		.importNode(player_template.content, true)
		.querySelector('.player');

	const player = new Player(players.length, {
		root: player_node,
		num: player_node.querySelector('.num'),
		producers: player_node.querySelector('.producers select'),
		users: player_node.querySelector('.users select'),
		name: player_node.querySelector('.name'),
		avatar_url: player_node.querySelector('input.avatar'),
		images: player_node.querySelector('.images'),
		avatar_img: player_node.querySelector('img.avatar'),
		country_code_select: player_node.querySelector('select.country_code'),
		country_code_img: player_node.querySelector('img.country_code'),
		victories: player_node.querySelector('.victories'),
		win_btn: player_node.querySelector('.winner'),
		game_over_btn: player_node.querySelector('.game_over'),
		cancel_game_over_btn: player_node.querySelector('.cancel_game_over'),
		remove_btn: player_node.querySelector('.remove_player'),
		camera_restart_btn: player_node.querySelector('.camera_restart'),
		camera_mirror_btn: player_node.querySelector('.camera_mirror'),
		focus_player_btn: player_node.querySelector('.focus_player'),
		remote_calibration_btn: player_node.querySelector('.remote_calibration'),
		vdo_ninja_url: player_node.querySelector('.vdo_ninja_url'),
	});

	players_node.appendChild(player_node);

	players.push(player);
}

function bootstrap() {
	// start with 2 players
	setBestOfOptions(MAX_BEST_OF, 3);

	dom.show_match_controls.style.display = 'none';

	dom.roomid.textContent = location.pathname.split('/')[3] || '_default';
	dom.producer_count.textContent = 0;

	dom.bestof.onchange = () =>
		remoteAPI.setBestOf(parseInt(dom.bestof.value, 10));

	dom.curtain_logo_url.onchange = () =>
		remoteAPI.setCurtainLogo(dom.curtain_logo_url.value);

	dom.setHideProfileCardOnNextGame.addEventListener('click', () => {
		remoteAPI.setHideProfileCardOnNextGame(true);
	});

	dom.count_down.addEventListener('click', () => {
		remoteAPI.startCountDown(5);
	});

	dom.clear_field_overlays.addEventListener('click', () => {
		remoteAPI.clearFieldOverlays();
	});

	dom.clear_victories.addEventListener('click', () => {
		remoteAPI.resetVictories();
	});

	dom.show_runways.addEventListener('click', () => {
		remoteAPI.showRunways();
	});

	dom.hide_runways.addEventListener('click', () => {
		remoteAPI.hideRunways();
	});

	dom.focus_none.addEventListener('click', () => {
		remoteAPI.focusPlayer(null);
	});

	dom.add_player.addEventListener('click', () => {
		remoteAPI.addPlayer();
	});

	dom.show_match_controls.querySelectorAll('input').forEach(radio =>
		radio.addEventListener('click', () => {
			const value =
				dom.show_match_controls.querySelector('input:checked').value;
			remoteAPI.setMatch(value ? parseInt(value, 10) : null);
		})
	);

	dom.show_profile_cards_controls
		.querySelectorAll('input')
		.forEach(checkbox => {
			checkbox.addEventListener('click', function () {
				remoteAPI.showProfileCard(this.checked, this.value);
			});
		});

	dom.allow_autojoin.addEventListener('click', function () {
		remoteAPI.allowAutoJoin(this.checked);
	});

	// =====

	window.connection = connection = new Connection();

	connection.onMessage = function (message) {
		const [command, ...args] = message;

		switch (command) {
			case 'state': {
				setState(args[0]);
				break;
			}

			case 'setVdoNinjaURL': {
				const [pidx, url] = args;
				players[pidx].setVdoNinjaURL(url);
				break;
			}

			case 'setOwner': {
				const owner = args[0];
				const player_url = `${location.protocol}//${location.host}/room/u/${owner.login}/producer`;

				dom.player_link.href = player_url;
				dom.player_link.textContent = player_url;

				break;
			}

			case 'setViewMeta': {
				const owner = args[0];
				const player_url = `${location.protocol}//${location.host}/room/u/${owner.login}/producer`;

				dom.player_link.href = player_url;
				dom.player_link.textContent = player_url;

				break;
			}

			default: {
				console.log(`Received unknow command ${command}`);
			}
		}
	};
}

bootstrap();
