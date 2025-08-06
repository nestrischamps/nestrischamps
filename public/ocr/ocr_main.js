import QueryString from '/js/QueryString.js';
import Connection from '/js/connection.js';
import BinaryFrame from '/js/BinaryFrame.js';
import loadDigitTemplates from '/ocr/templates.js';
import loadPalettes from '/ocr/palettes.js';
import GameTracker from '/ocr/GameTracker.js';
import EDClient from '/ocr/EDClient.js';
import EDGameTracker from '/ocr/EDGameTracker.js';
import {
	getFieldCoordinates,
	getCaptureCoordinates,
} from '/ocr/calibration.js';
import { peerServerOptions, PIECES, LEVEL_COLORS } from '/views/constants.js';
import speak from '/views/tts.js';

// NTSC NES resolution: 256x224 -> 512x448

const reference_size = [512, 448];
const reference_locations = {
	score: { crop: [384, 112, 94, 14], pattern: 'ADDDDD' },
	score7: { crop: [384, 112, 110, 14], pattern: 'DDDDDDD' },
	level: { crop: [416, 320, 30, 14], pattern: 'TD' }, // TD, because we only care about start level, which is 29 or lower
	lines: { crop: [304, 32, 46, 14], pattern: 'QDD' },
	field_w_borders: { crop: [190, 78, 162, 324] },
	field: { crop: [192, 80, 158, 318] },
	preview: { crop: [384, 224, 62, 30] },
	color1: { crop: [76, 170, 10, 10] },
	color2: { crop: [76, 212, 10, 10] },
	color3: { crop: [76, 246, 10, 10] },
	instant_das: { crop: [80, 64, 30, 14], pattern: 'BD' },
	cur_piece_das: { crop: [112, 96, 30, 14], pattern: 'BD' },
	cur_piece: { crop: [30, 89, 45, 23] },
	T: { crop: [96, 176, 46, 14], pattern: 'BDD', red: true },
	J: { crop: [96, 208, 46, 14], pattern: 'BDD', red: true },
	Z: { crop: [96, 240, 46, 14], pattern: 'BDD', red: true },
	O: { crop: [96, 272, 46, 14], pattern: 'BDD', red: true },
	S: { crop: [96, 304, 46, 14], pattern: 'BDD', red: true },
	L: { crop: [96, 336, 46, 14], pattern: 'BDD', red: true },
	I: { crop: [96, 368, 46, 14], pattern: 'BDD', red: true },
};

const configs = {
	classic: {
		game_type: BinaryFrame.GAME_TYPE.CLASSIC,
		reference: '/ocr/reference_ui_classic.png',
		fields: [
			'score',
			'level',
			'lines',
			'field',
			'preview',
			'color1',
			'color2',
			'color3',
			'T',
			'J',
			'Z',
			'O',
			'S',
			'L',
			'I',
		],
	},
	das_trainer: {
		game_type: BinaryFrame.GAME_TYPE.DAS_TRAINER,
		reference: '/ocr/reference_ui_das_trainer.png',
		palette: 'easiercap',
		fields: [
			'score',
			'level',
			'lines',
			'field',
			'preview',
			'instant_das',
			'cur_piece_das',
			'cur_piece',
		],
	},
	minimal: {
		game_type: BinaryFrame.GAME_TYPE.MINIMAL,
		reference: '/ocr/reference_ui_classic.png',
		palette: 'easiercap',
		fields: ['score', 'level', 'lines', 'field', 'preview'],
	},
};

const send_binary = QueryString.get('binary') !== '0';

const default_frame_rate = 60;

const is_match_room = /^\/room\/u\//.test(new URL(location).pathname);

export function css_size(css_pixel_width) {
	return parseFloat(css_pixel_width.replace(/px$/, ''));
}

const tabsContainer = document.querySelector('#tabs'),
	tabs = document.querySelectorAll('#tabs li'),
	tabContentsContainer = document.querySelector('#tab-content'),
	tabContents = document.querySelectorAll('#tab-content > div'),
	room = document.querySelector('#room'),
	set_ready = room.querySelector('button#set-ready'),
	not_ready = room.querySelector('button#not-ready'),
	video_capture = document.querySelector('#video_capture'),
	wizard = document.querySelector('#wizard'),
	device_selector = document.querySelector('#device'),
	allow_video_feed = document.querySelector('#allow_video_feed'),
	video_feed_selector = document.querySelector('#video_feed_device'),
	video_feed = document.querySelector('#video_feed'),
	vdo_ninja = document.querySelector('#vdo_ninja'),
	color_matching = document.querySelector('#color_matching'),
	palette_selector = document.querySelector('#palette'),
	rom_selector = document.querySelector('#rom'),
	instructions = document.querySelector('#instructions'),
	capture_rate = document.querySelector('#capture_rate'),
	show_parts = document.querySelector('#show_parts'),
	score7 = document.querySelector('#score7'),
	use_half_height = document.querySelector('#use_half_height'),
	use_worker_for_interval = document.querySelector('#use_worker_for_interval'),
	handle_retron_levels_6_7 = document.querySelector(
		'#handle_retron_levels_6_7'
	),
	focus_alarm = document.querySelector('#focus_alarm'),
	clear_config = document.querySelector('#clear_config'),
	save_game_palette = document.querySelector('#save_game_palette'),
	timer_control = document.querySelector('#timer_control'),
	start_timer = document.querySelector('#start_timer'),
	video = document.querySelector('#device_video'),
	frame_data = document.querySelector('#frame_data'),
	perf_data = document.querySelector('#perf_data'),
	capture = document.querySelector('#capture'),
	adjustments = document.querySelector('#adjustments'),
	image_corrections = document.querySelector('#image_corrections'),
	brightness_slider = image_corrections.querySelector('.brightness input'),
	brightness_value = image_corrections.querySelector('.brightness span'),
	brightness_reset = image_corrections.querySelector('.brightness a'),
	contrast_slider = image_corrections.querySelector('.contrast input'),
	contrast_value = image_corrections.querySelector('.contrast span'),
	contrast_reset = image_corrections.querySelector('.contrast a');

const UNFOCUSED_ALARM_SND = new Audio('/ocr/alarm.mp3');
const UNFOCUSED_SILENCE_SND = new Audio('/ocr/silence.mp3');
const UNFOCUSED_ALARM_LOOPS = 4;

let templates;
let palettes;
let game_tracker;
let config;
let connection;
let pending_calibration = false;

device_selector.addEventListener('change', evt => {
	config.device_id = device_selector.value;

	if (config.device_id === 'everdrive') {
		initCaptureFromEverdrive(config.frame_rate);
		saveConfig(config);

		removeCalibrationTab();
		showProducerUI();
		tabs[1].click(); // data
	} else {
		config.use_half_height = false;
		use_half_height.checked = false;

		if (config.device_id === 'window') {
			use_half_height.parentNode.style.display = 'none';
		} else {
			use_half_height.parentNode.style.display = null;
		}

		saveConfig(config);
		playVideoFromConfig();
		checkReadyToCalibrate();
	}
});

video_feed_selector.addEventListener('change', evt => {
	config.video_feed_device_id = video_feed_selector.value;
	saveConfig(config);
	restartSharingVideoFeed();
});

palette_selector.disabled = true;
palette_selector.addEventListener('change', evt => {
	config.palette = palette_selector.value;
	checkReadyToCalibrate();
});

rom_selector.addEventListener('change', evt => {
	const first_option = palette_selector.querySelector('option:first-child');

	function hideAndResetColorMatching() {
		color_matching.classList.add('is-hidden');
		palette_selector.disabled = true;
	}

	palette_selector.value = palettes._saved ? '_saved' : '';

	if (rom_selector.value === '') {
		hideAndResetColorMatching();
	} else {
		config.game_type = configs[rom_selector.value].game_type;

		color_matching.classList.remove('is-hidden');
		palette_selector.disabled = false;

		if (rom_selector.value === 'classic') {
			// Allows all color matching options
			first_option.disabled = false;
			first_option.hidden = false;
		} else {
			first_option.disabled = true;
			first_option.hidden = true;

			const valid_palettes = Object.keys(palettes);

			if (palette_selector.value === '') {
				// read from frame is not allowed!
				palette_selector.value = valid_palettes[0]; // pick first palette as new default
			}

			// If there's a single valid palette, we hide the palette selector
			if (valid_palettes.length <= 1) {
				hideAndResetColorMatching();
			}
		}
	}

	config.palette = palette_selector.value;

	checkReadyToCalibrate();
});

capture_rate.addEventListener('change', updateFrameRate);

function checkReadyToCalibrate() {
	// no need to check palette, if rom_selector has a value, then palette automatically has a valid value too
	const all_ready = device_selector.value && rom_selector.value;

	pending_calibration = !!all_ready;

	instructions.classList[pending_calibration ? 'remove' : 'add']('is-hidden');
}

const notice = document.querySelector('div.notice');

function resetNotice() {
	notice.classList.remove('error', 'warning');
	notice.classList.add('is-hidden');
	notice.textContent = '';
}

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

		if (roomIFrame) {
			loadRoomView();
		}
		startSharingVideoFeed();
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

	connection = new Connection();

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
			startSharingVideoFeed();
		});

		peer.on('error', err => {
			console.log(`Peer error: ${err.message}`);
			peer.retryTO = clearTimeout(peer.retryTO); // there should only be one retry scheduled
			peer.retryTO = setTimeout(startSharingVideoFeed, 1500); // we assume this will succeed at some point?? 😰😅
		});
	};
}

let ongoing_call = null;

async function startSharingVideoFeed() {
	console.log('startSharingVideoFeed', view_meta);

	stopSharingVideoFeed();

	console.log(Date.now(), {
		allow_video_feed: allow_video_feed.checked,
		video_feed_selector: video_feed_selector.value,
		is_player,
		peer: !!peer,
		view_peer_id,
		view_meta,
	});

	if (!allow_video_feed.checked) return;
	if (!video_feed_selector.value) return;
	if (!is_player || !peer || !view_peer_id || !view_meta || !view_meta._video)
		return;

	const video_constraints = {
		width: { ideal: 320 },
		height: { ideal: 240 },
		frameRate: { ideal: 15 }, // players hardly move... no need high fps?
	};

	const m = (view_meta._video || '').match(/^(\d+)x(\d+)$/);

	if (m) {
		video_constraints.width.ideal = parseInt(m[1], 10);
		video_constraints.height.ideal = parseInt(m[2], 10);
	}

	if (video_feed_selector.value === 'default') {
		delete video_constraints.deviceId;
	} else {
		video_constraints.deviceId = { exact: video_feed_selector.value };
	}

	console.log(Date.now(), 'Probing for cam feed');

	const stream = await navigator.mediaDevices.getUserMedia({
		audio: QueryString.get('webcam_audio') === '1',
		video: video_constraints,
	});

	video_feed.srcObject = stream;
	video_feed.play();

	function startSharing() {
		console.log(Date.now(), `startSharing ${peer.id} -> ${view_peer_id}`);

		// 1. player cam
		ongoing_call = peer.call(view_peer_id, stream);

		if (view_meta._raw === '1') {
			// 2. raw capture
			const xywh = [...config.tasks.field.crop];

			if (use_half_height.checked) {
				xywh[1] *= 2;
				xywh[3] *= 2;
			}

			const r_xywh = getCaptureCoordinates(
				reference_size,
				reference_locations.field.crop,
				xywh
			);

			r_xywh[0] /= video.videoWidth;
			r_xywh[1] /= video.videoHeight;
			r_xywh[2] /= video.videoWidth;
			r_xywh[3] /= video.videoHeight;

			peer.call(view_peer_id, video.srcObject, {
				metadata: {
					raw: true,
					r_xywh,
				},
			});
		}
	}

	if (peer._open) {
		startSharing();
	}
}

function stopSharingVideoFeed() {
	video_feed.pause();
	video_feed.srcObject = null;

	try {
		ongoing_call.close();
	} catch (err) {}

	ongoing_call = null;
}

function restartSharingVideoFeed() {
	if (!ongoing_call) return;
	startSharingVideoFeed();
}

clear_config.addEventListener('click', evt => {
	if (
		confirm(
			'You are about to remove your current configuration. You will have to recalibrate. Are you sure?'
		)
	) {
		localStorage.removeItem('config');
		location.reload();
	}
});

save_game_palette.addEventListener('click', evt => {
	if (palettes && game_tracker && config) {
		localStorage.setItem('palette', JSON.stringify(save_game_palette.palette));

		palettes._saved = palette;
		config.palette = '_saved';

		saveConfig(config);
		location.reload();
	}
});

start_timer.addEventListener('click', evt => {
	// minutes are valid per markup restrictions
	const minutes = parseInt(document.querySelector('#minutes').value, 10);

	connection.send(['startTimer', minutes * 60]);
});

video.controls = false;
video.style.cursor = 'crosshair';
video.addEventListener('click', async evt => {
	evt.preventDefault();
	if (!pending_calibration) return;

	// TODO: should be a state system
	// pending_calibration = false;

	const video_styles = getComputedStyle(video);
	const ratioX = evt.offsetX / css_size(video_styles.width);
	const ratioY = evt.offsetY / css_size(video_styles.height);
	const floodStartPoint = [
		Math.round(video.videoWidth * ratioX),
		Math.round(video.videoHeight * ratioY),
	];

	device_selector.disabled = true;
	rom_selector.disabled = true;

	// set up config per rom selection
	const rom_config = configs[rom_selector.value];

	const video_capture_ctx = video_capture.getContext('2d', { alpha: false });
	const bitmap = await createImageBitmap(
		video,
		0,
		0,
		video.videoWidth,
		video.videoHeight
	);

	updateCanvasSizeIfNeeded(video_capture, video.videoWidth, video.videoHeight);

	if (video.ntcType === 'device') {
		video_capture_ctx.filter = 'brightness(1.75) contrast(1.75)';
	} else {
		video_capture_ctx.filter = 'contrast(1.5)';
	}
	video_capture_ctx.drawImage(bitmap, 0, 0);

	await new Promise(resolve => {
		setTimeout(resolve, 0); // wait one tick for everything to be drawn nicely... just in case
	});

	const img_data = video_capture_ctx.getImageData(
		0,
		0,
		video.videoWidth,
		video.videoHeight
	);

	// Get field coordinates via flood-fill (includes borders on all sides)
	// Question: instead of targetting black, should we just take the selected color as reference?
	let field_w_borders_xywh;
	try {
		field_w_borders_xywh = getFieldCoordinates(
			img_data,
			floodStartPoint,
			[0, 0, 0], // targeting black
			42 // 42 is a very high tolerance, but this is to work around a "washed out colors" bug in chrome
		);
	} catch (err) {
		let message = `Unable to find field coordinates: ${err.message}`;

		if (err.cause) {
			if (err.cause.msg) delete err.cause.msg;
			message += `\n\n${JSON.stringify(err.cause)}`;
		}

		message += `\n\nTry again, or contact NesTrisChamps devs for assistance.`;

		alert(message);
		return;
	}

	console.log('field coordinates', field_w_borders_xywh);

	let [ox, oy, ow, oh] = getCaptureCoordinates(
		reference_size,
		reference_locations.field_w_borders.crop,
		field_w_borders_xywh
	);

	if (ow <= 0 || oh <= 0) {
		console.log('Unable to match template');
		ox = 0;
		oy = 0;
		ow = video.videoWidth;
		oh = video.videoHeight;
	} else {
		console.log('Found offsets!');
	}

	if (use_half_height.checked) {
		oy /= 2;
		oh /= 2;
	}

	console.log('Using offsets: ', ox, oy, ow, oh);

	const xscale = ow / reference_size[0];
	const yscale = oh / reference_size[1];

	console.log('scale factors', xscale, yscale);

	rom_config.fields.forEach(name => {
		config.tasks[name] = JSON.parse(JSON.stringify(reference_locations[name]));

		const crop = config.tasks[name].crop;

		console.log(name, 'crop before', crop);

		crop[0] = Math.round(ox + crop[0] * xscale);
		crop[1] = Math.round(oy + crop[1] * yscale);
		crop[2] = Math.round(crop[2] * xscale);
		crop[3] = Math.round(crop[3] * yscale);

		console.log(name, 'crop after', crop);
	});

	config.score7 = false;

	saveConfig(config);
	trackAndSendFrames();

	if (video.ntcType === 'device') {
		brightness_slider.value = 1.75;
		onBrightnessChange();
	}

	video.style.cursor = null;
	capture.prepend(video);
	tabs[2].click(); // calibration
	showProducerUI();

	setTimeout(() => {
		alert(
			'Rough calibration has been completed 🎉!\n\nYou now MUST inspect and fine tune all the fields (location and size) to make them pixel perfect!'
		);
	}, 100); // sad (and gross) delay
});

function onShowPartsChanged() {
	const display = show_parts.checked ? 'block' : 'none';

	try {
		adjustments.style.display = display;
		config.source_canvas.style.display = display;
	} catch (err) {
		// nothing to do here
	}

	if (show_parts.checked) {
		resetShowPartsTimer();
	}
}

show_parts.addEventListener('change', onShowPartsChanged);

function onScore7Changed() {
	config.score7 = score7.checked;

	const scale6to7 =
		reference_locations.score7.crop[2] / reference_locations.score.crop[2];

	// assume transition is valid
	if (config.score7) {
		config.tasks.score.crop[2] *= scale6to7;
		config.tasks.score.pattern = reference_locations.score7.pattern;
	} else {
		config.tasks.score.crop[2] /= scale6to7;
		config.tasks.score.pattern = reference_locations.score.pattern;
	}

	config.tasks.score.crop[2] = Math.round(config.tasks.score.crop[2]);

	// update score input field for width
	const inputs = document.querySelectorAll(`fieldset.score input`);

	inputs[2].value = config.tasks.score.crop[2];

	resetConfig('score');
}

score7.addEventListener('change', onScore7Changed);

function onUseHalfHeightChanged() {
	config.use_half_height = use_half_height.checked;

	// we need to update EVERYTHING :'(
	// assume transition is valid
	if (config.use_half_height) {
		// half the y and height of everything
		for (const [name, task] of Object.entries(config.tasks)) {
			if (!task?.crop) continue;

			const inputs = document.querySelectorAll(
				`#adjustments fieldset.${name} input.coordinate_input`
			);

			inputs[1].value = Math.floor(task.crop[1] / 2);
			inputs[3].value = Math.ceil(task.crop[3] / 2);

			resetConfig(name);
		}
	} else {
		for (const [name, task] of Object.entries(config.tasks)) {
			if (!task?.crop) continue;

			const inputs = document.querySelectorAll(
				`#adjustments fieldset.${name} input.coordinate_input`
			);

			inputs[1].value = task.crop[1] * 2;
			inputs[3].value = task.crop[3] * 2;

			resetConfig(name);
		}
	}
}

use_half_height.addEventListener('change', onUseHalfHeightChanged);

function onUseWorkerIntervalChanged() {
	stopCapture();
	config.use_worker_for_interval = !!use_worker_for_interval.checked;
	timer = config.use_worker_for_interval ? workerTimer : stdTimer;
	saveConfig(config);
	startCapture();
}

use_worker_for_interval.addEventListener('change', onUseWorkerIntervalChanged);

function onHandleRetronLevels67Changed() {
	config.handle_retron_levels_6_7 = !!handle_retron_levels_6_7.checked;
	saveConfig(config);
	// config is accessed by reference in TetrisOCR
	// That's a bit dirty, but for now that means no need to do anything beyond saving, because nothing changes from this setting
	// dirty, because this file shouldn't know if anything changes or not
}

handle_retron_levels_6_7.addEventListener(
	'change',
	onHandleRetronLevels67Changed
);

function onPrivacyChanged() {
	config.allow_video_feed = !!allow_video_feed.checked;

	saveConfig(config);

	if (config.allow_video_feed) {
		startSharingVideoFeed();

		vdo_ninja.checked = false;
		onVdoNinjaChange();
	} else {
		stopSharingVideoFeed();
	}
}

allow_video_feed.addEventListener('change', onPrivacyChanged);

function onVdoNinjaChange() {
	const iframe = document.querySelector('#vdoninja');

	if (vdo_ninja.checked) {
		// 1. start up vdo ninja
		const chars =
			'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(
				''
			);
		const streamid = `_NTC_${Array(8)
			.fill()
			.map(() => chars[Math.floor(Math.random() * chars.length)])
			.join('')}`;

		const url = new URL('https://vdo.ninja/');
		url.searchParams.set('view', streamid);
		url.searchParams.set('cover', 1);
		url.searchParams.set('transparent', 0);

		const viewURL = url.toString();

		url.searchParams.delete('view');
		url.searchParams.delete('cover');
		url.searchParams.set('push', streamid);
		url.searchParams.set('webcam', 1);
		url.searchParams.set('audiodevice', 0);
		url.searchParams.set('autostart', 1);

		iframe.src = url.toString();

		connection.send(['setVdoNinjaURL', viewURL]);
		navigator.clipboard.writeText(viewURL);
		document.querySelector('#vdo_ninja_url').textContent =
			`${viewURL} (URL has been copied to clipboard)`;

		// 2. cancel peerjs video
		allow_video_feed.checked = false;
		onPrivacyChanged();
	} else {
		iframe.src = '';
		connection.send(['setVdoNinjaURL', '']);
		document.querySelector('#vdo_ninja_url').textContent = '';
	}
}

vdo_ninja.addEventListener('change', onVdoNinjaChange);

function onFocusAlarmChanged() {
	config.focus_alarm = !!focus_alarm.checked;

	saveConfig(config);

	if (!config.focus_alarm) {
		stopUnfocusedAlarm(); // shoud not be needed, since window is focused when value changes, but just in case
	}
}

focus_alarm.addEventListener('change', onFocusAlarmChanged);

set_ready.addEventListener('click', () => {
	connection?.send(['setReady', true]);
});

not_ready.addEventListener('click', () => {
	connection?.send(['setReady', false]);
});

// ====================
// START: Image corrections

function updateImageCorrection() {
	const filters = [];

	if (config.brightness !== undefined && config.brightness > 1) {
		filters.push(`brightness(${config.brightness})`);
	}

	if (config.contrast !== undefined && config.contrast !== 1) {
		filters.push(`contrast(${config.contrast})`);
	}

	if (filters.length) {
		video.style.filter = filters.join(' ');
	} else {
		video.style.filter = null;
		delete video.style.filter;
	}

	if (game_tracker) {
		game_tracker.setConfig(config);
	}
}

function onBrightnessChange() {
	const value = parseFloat(brightness_slider.value);
	brightness_value.textContent = value.toFixed(2);
	config.brightness = value;
	saveConfig(config);
	updateImageCorrection();
}

function onBrightnessReset(evt) {
	evt.preventDefault();
	brightness_slider.value = 1;
	onBrightnessChange();
}

function onContrastChange() {
	const value = parseFloat(contrast_slider.value);
	contrast_value.textContent = value.toFixed(2);
	config.contrast = value;
	saveConfig(config);
	updateImageCorrection();
}

function onContrastReset(evt) {
	evt.preventDefault();
	contrast_slider.value = 1;
	onContrastChange();
}

brightness_slider.addEventListener('change', onBrightnessChange);
brightness_reset.addEventListener('click', onBrightnessReset);
contrast_slider.addEventListener('change', onContrastChange);
contrast_reset.addEventListener('click', onContrastReset);

// ====================
// STOP: Image corrections

let hide_show_parts_timer;

function hideParts() {
	show_parts.checked = false;
	onShowPartsChanged();
}

function resetShowPartsTimer() {
	clearTimeout(hide_show_parts_timer);

	hide_show_parts_timer = setTimeout(hideParts, 45000); // parts stop showing after 45s of static config
}

function updatePaletteList() {
	palette_selector.innerHTML = '';

	[
		{
			label: 'Read from frame',
			value: '',
		},
		...Object.keys(palettes).map(value => ({
			label: `${value} palette`,
			value,
		})),
	].forEach(option => {
		const palette_option = document.createElement('option');
		palette_option.text = option.label;
		palette_option.value = option.value;

		if (config && config.palette === option.value) {
			palette_option.selected = true;
		}

		palette_selector.appendChild(palette_option);
	});
}

// Updates the select element with the provided set of cameras
function updateDeviceList(devices) {
	console.log(Date.now(), 'updateDeviceList');

	// Make sure we show devices with their IDs
	const mappedDevices = devices.map(camera => {
		const device = { label: camera.label, deviceId: camera.deviceId };

		// Drop the manufacturer:make identifier because it's (typically) not useful
		device.label = device.label.replace(
			/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/,
			''
		);

		// Add a short form for the device id
		if (camera.deviceId?.slice) {
			const id = camera.deviceId;
			const shortId = `${id.slice(0, 4)}..${id.slice(-4)}`;
			device.label += ` [${shortId}]`;
		}

		return device;
	});

	const default_devices = [
		{
			label: '-',
			deviceId: '',
		},
		{
			label: 'Window Capture',
			deviceId: 'window',
		},
	];

	if ('serial' in navigator) {
		default_devices.splice(1, 0, {
			label: 'Everdrive N8 Pro - Direct USB Capture',
			deviceId: 'everdrive',
		});
	} else {
		device_selector.after('(For EverDrive Capture, use Chrome)');
	}

	device_selector.replaceChildren(
		...[...default_devices, ...mappedDevices].map(camera => {
			const camera_option = document.createElement('option');
			camera_option.text = camera.label;
			camera_option.value = camera.deviceId;

			if (config && config.device_id === camera.deviceId) {
				camera_option.selected = true;
			}

			return camera_option;
		})
	);

	// Then populate for video feed
	// TODO: handle case of no webcam
	console.log(Date.now(), 'updateDeviceList: populate video_feed_selector');
	video_feed_selector.replaceChildren(
		...[
			{
				label: 'Default',
				deviceId: 'default',
			},
			...mappedDevices,
		].map(camera => {
			const camera_option = document.createElement('option');
			camera_option.text = camera.label;
			camera_option.value = camera.deviceId;

			if (config && config.video_feed_device_id === camera.deviceId) {
				camera_option.selected = true;
			}

			return camera_option;
		})
	);
}

async function getConnectedDevices(type) {
	let stream;

	try {
		// prompt for permission if needed
		// on windows, this requests the first available capture device and it may fail
		// BUT if permission has been granted, then listing the devices below might still work
		// SO, we wrap the device call in a try..catch, and ignore errors
		stream = await navigator.mediaDevices.getUserMedia({ video: true });
	} catch (err) {
		// We log a warning but we do nothing
		console.log(
			`Warning: could not open default capture device: ${err.message}`
		);
	}

	const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
		device => device.kind === type && device.deviceId
	);

	if (stream) stream.getTracks()[0].stop();

	return devices;
}

async function resetDevices() {
	const devicesList = await getConnectedDevices('videoinput');
	updateDeviceList(devicesList);
}

navigator.mediaDevices.addEventListener('devicechange', resetDevices);

let edClient;
let edGameTracker;

async function initCaptureFromEverdrive() {
	let last_frame = { field: [] };

	edGameTracker = new EDGameTracker();
	edClient = new EDClient(config.frame_rate);

	// piping callbacks -_- ... a stream interface would be nicer
	edClient.onData = edGameTracker.setData;
	edGameTracker.onFrame = data => {
		performance.mark('show_data_start');
		showFrameData(data);
		performance.mark('show_data_end');

		performance.measure(
			'edlink_write',
			'edlink_comm_start',
			'edlink_write_end'
		);
		performance.measure('edlink_read', 'edlink_write_end', 'edlink_read_end');
		performance.measure(
			'edlink_comm_total',
			'edlink_comm_start',
			'edlink_read_end'
		);

		performance.measure(
			'extract_data',
			'extract_data_start',
			'extract_data_end'
		);
		performance.measure('show_frame_data', 'show_data_start', 'show_data_end');

		const perf = {};

		performance.getEntriesByType('measure').forEach(m => {
			perf[m.name] = m.duration.toFixed(3);
		});

		showPerfData(perf);

		performance.clearMarks();
		performance.clearMeasures();

		if (!data) return;

		// 6. transmit frame to NTC server if necessary
		check_equal: do {
			for (let key in data) {
				if (key[0] === '_') continue;
				if (key === 'ctime') continue;
				if (key === 'field') {
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
		connection.send(BinaryFrame.encode(data));
	};
}

async function playVideoFromDevice(device_id, fps) {
	console.log('playVideoFromDevice()');

	try {
		const constraints = {
			audio: false,
			video: {
				height: { ideal: 480 },
				frameRate: { ideal: fps }, // Should we always try to get the highest the card can support?
			},
		};

		if (device_id) {
			constraints.video.deviceId = { exact: device_id };
		}

		console.log(`Capture Constraints: ${JSON.stringify(constraints, null, 2)}`);

		const stream = await navigator.mediaDevices.getUserMedia(constraints);

		// we only prompt for permission with the first call
		if (device_id === undefined) return;

		logStreamDetails(stream);

		// when an actual device id is supplied, we start everything
		video.srcObject = stream;
		video.ntcType = 'device';
		video.play();
	} catch (error) {
		console.error('Error opening video camera.', error);
		video.pause();
	}
}

async function playVideoFromScreenCap(fps) {
	try {
		const constraints = {
			audio: false,
			video: {
				cursor: 'never',
				frameRate: { ideal: fps },
			},
		};

		const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

		// when an actual device id is supplied, we start everything
		video.srcObject = stream;
		video.ntcType = 'screencap';
		video.play();
	} catch (error) {
		console.error('Error capturing window.', error);
		video.pause();
	}
}

async function playVideoFromConfig() {
	if (!config.device_id) {
		return;
	}

	video.classList.remove('is-hidden');

	if (config.device_id === 'window') {
		await playVideoFromScreenCap(config.frame_rate);
	} else {
		await playVideoFromDevice(config.device_id, config.frame_rate);
	}

	capture_rate
		.querySelectorAll('.device_only')
		.forEach(elmt => (elmt.hidden = config.device_id === 'window'));
}

let capture_process;
let frame_count = 0;

async function updateFrameRate() {
	try {
		video.srcObject.getVideoTracks()[0].stop();
	} catch (err) {}

	stopCapture();

	config.frame_rate = parseInt(capture_rate.value, 10);
	saveConfig(config);

	await playVideoFromConfig();

	startCapture();
}

function stopCapture() {
	timer.clearInterval(capture_process);
}

function logStreamDetails(stream) {
	const track = stream.getVideoTracks()[0];
	const settings = track.getSettings();
	const capabilities = track.getCapabilities?.() || null;

	console.log(`Stream Details: ${JSON.stringify(settings, null, 2)}`);
	console.log(`Stream Capabilities: ${JSON.stringify(capabilities, null, 2)}`);

	/*
	console.log(
		`Video settings: ${settings.width}x${
			settings.height
		}@${settings.frameRate.toFixed(1)}fps`
	);
	/**/
}

async function startCapture(stream) {
	console.log('startCapture()');

	stopCapture();

	if (!stream) {
		stream = video.srcObject;

		if (!stream) {
			return;
		}
	}

	stream.addEventListener('inactive', console.log('stream is inactive'));
	stream.addEventListener('close', console.log('stream is closed'));

	const track = stream.getVideoTracks()[0];
	const settings = track.getSettings();

	if (show_parts.checked) {
		adjustments.style.display = 'block';
		// image_corrections.style.display = 'block';
		tabs[2].click(); // calibration
	}

	const frame_ms = 1000 / settings.frameRate;

	console.log(
		`Setting capture interval for ${settings.frameRate}fps (i.e. ${frame_ms}ms per frame)`
	);
	capture_process = timer.setInterval(captureFrame, frame_ms);
}

let last_frame_time = 0;

let unfocused_alarm_loop_counter = 0;
let unfocused_abnormal_elapsed = 750; // If capture interval runs at 750ms, capture is messed
let unfocused_alarm_playing = false;

let unfocused_smoothing_factor = 1 / 15; // causes roughly 20s delay from when interval jumps from 33ms to 1000ms
let unfocused_smoothed_elapsed = 0;

function playUnfocusedAlarm() {
	if (!unfocused_alarm_playing) return;

	unfocused_alarm_loop_counter =
		++unfocused_alarm_loop_counter % UNFOCUSED_ALARM_LOOPS;

	if (unfocused_alarm_loop_counter === 0) {
		// Say Message
		delete UNFOCUSED_ALARM_SND.onended;
		speak(
			{
				username: '_system',
				display_name: 'System',
				message: 'Warning! Nestris champs OCR page is not active!',
			},
			{ now: true, callback: playUnfocusedAlarm }
		);
	} else {
		// Play alarm
		UNFOCUSED_ALARM_SND.onended = playUnfocusedAlarm;
		UNFOCUSED_ALARM_SND.play();
	}
}

function startUnfocusedAlarm() {
	if (unfocused_alarm_playing) return;

	unfocused_alarm_playing = true;
	unfocused_alarm_loop_counter = 0;
	playUnfocusedAlarm();

	// play silence sound continuously to disable timer throttling
	UNFOCUSED_SILENCE_SND.loop = true;
	UNFOCUSED_SILENCE_SND.play();

	window.addEventListener('focus', stopUnfocusedAlarm);
}

function stopUnfocusedAlarm() {
	delete UNFOCUSED_ALARM_SND.onended;
	unfocused_alarm_playing = false;
	unfocused_smoothed_elapsed = 0;

	UNFOCUSED_ALARM_SND.pause();
	UNFOCUSED_SILENCE_SND.pause();

	window.removeEventListener('focus', stopUnfocusedAlarm);
}

async function captureFrame() {
	++frame_count;

	const now = Date.now();

	if (focus_alarm.checked && last_frame_time) {
		const elapsed = Date.now() - last_frame_time;

		unfocused_smoothed_elapsed =
			unfocused_smoothing_factor * elapsed +
			(1 - unfocused_smoothing_factor) * unfocused_smoothed_elapsed;

		if (unfocused_smoothed_elapsed > unfocused_abnormal_elapsed) {
			startUnfocusedAlarm();
		}
	}

	last_frame_time = now;

	try {
		let bitmap;

		// let's assume that pixelated resize of height divided 2 is the same as dropping every other row
		// which is equivalent to deinterlacing *cough*

		performance.mark('capture_start');
		if (video.videoWidth && video.videoHeight) {
			bitmap = await createImageBitmap(
				video,
				0,
				0,
				video.videoWidth,
				video.videoHeight
			);
		}
		performance.mark('capture_end');

		if (bitmap) {
			game_tracker.processFrame(bitmap);
		}
	} catch (err) {
		console.error(err);
	}
}

function updateCanvasSizeIfNeeded(canvas, w, h) {
	if (canvas.width != w || canvas.height != h) {
		canvas.width = w;
		canvas.height = h;

		// must restore no smoothing after change of size
		canvas.getContext('2d', { alpha: false }).imageSmoothingEnabled = false;
	}
}

function resetConfig(task_name) {
	if (task_name) {
		const task_crop = [
			...document.querySelectorAll(
				`#adjustments fieldset.${task_name} input.coordinate_input`
			),
		].map(el => parseInt(el.value, 10));

		config.tasks[task_name].crop = task_crop;

		// update display canvas with new data
		const canvas = config.tasks[task_name].crop_canvas_ctx.canvas;
		const scale_factor = task_name.startsWith('color') ? 4 : 2;

		updateCanvasSizeIfNeeded(
			canvas,
			task_crop[2] * scale_factor,
			task_crop[3] * scale_factor
		);
	}

	// set the new config - this may reset the scale_img size for score
	game_tracker.setConfig(config);

	if (task_name === 'score') {
		const canvas = config.tasks.score.scale_canvas_ctx.canvas;
		const scale_factor = 2;
		const scale_img = config.tasks.score.scale_img;

		updateCanvasSizeIfNeeded(
			canvas,
			scale_img.width * scale_factor,
			scale_img.height * scale_factor
		);
	}

	updateCanvasSizeIfNeeded(
		config.source_canvas,
		config.capture_area.w,
		config.capture_area.h
	);

	saveConfig(config);
}

function bindPieceStatsXWInputs() {
	// bind field 0 (x) and 2 (width)
	[0, 2].forEach(input_idx => {
		const inputs = PIECES.map(name =>
			document.querySelector(`fieldset.${name}`)
		).map(parent => parent.querySelectorAll('input')[input_idx]);

		inputs.forEach(input => {
			input.addEventListener('change', () => {
				const value = input.value;
				inputs.forEach((link, idx) => {
					if (link === input) return;
					link.value = value;
					resetConfig(PIECES[idx]);
				});
			});
		});
	});
}

function bindColorsXInputs() {
	const inputs = [1, 2, 3]
		.map(num => document.querySelector(`fieldset.color${num}`))
		.map(parent => parent.querySelectorAll('input')[0]);

	inputs.forEach(input => {
		input.addEventListener('change', () => {
			const value = input.value;
			inputs.forEach((link, idx) => {
				if (link === input) return;
				link.value = value;
				resetConfig(`color${idx + 1}`);
			});
		});
	});
}

function showColorControls(palettes, config) {
	const has_valid_palette = !!(config.palette && palettes[config.palette]);
	const display = has_valid_palette ? 'none' : 'block';

	const color_fieldset = document.querySelector(`fieldset.color1`);

	if (!color_fieldset) return;

	[1, 2, 3].forEach(num => {
		const col_elmt = document.querySelector(`fieldset.color${num}`);

		if (col_elmt) {
			col_elmt.style.display = display;
		}
	});

	if (!has_valid_palette) bindColorsXInputs();
}

function showConfigControls(templates, palettes, config) {
	// use static display order
	for (const name of Object.keys(reference_locations)) {
		const task = config.tasks[name];

		if (!task) continue;

		const fieldset = document.createElement('fieldset');
		fieldset.classList.add(name);

		const legend = document.createElement('legend');
		legend.textContent = name;
		fieldset.appendChild(legend);

		addCropControls(fieldset, config, name, resetConfig);

		const canvas_holder = document.createElement('div');
		canvas_holder.classList.add('results');
		fieldset.appendChild(canvas_holder);

		adjustments.appendChild(fieldset);
	}

	showColorControls(palettes, config);

	if (config.tasks.T) {
		bindPieceStatsXWInputs();
	}
}

function addCropControls(parent, config, name, onChangeCallback) {
	const holder = document.createElement('div');
	const inputs = [];

	function onChange() {
		onChangeCallback(name);
	}

	['x', 'y', 'width', 'height'].forEach((label, idx) => {
		const span = document.createElement('span');
		span.textContent = ` ${label}: `;

		const input = document.createElement('input');
		input.classList.add('coordinate_input');
		input.type = 'number';
		input.size = 3;
		input.value = config.tasks[name].crop[idx];
		input.addEventListener('change', onChange);

		inputs.push(input);

		holder.appendChild(span);
		holder.appendChild(input);
	});

	parent.appendChild(holder);
}

async function showParts(data) {
	const source_height = Math.floor(config.source_img.height);

	if (!config.source_canvas) {
		const source_canvas = document.createElement('canvas');
		source_canvas.width = config.source_img.width;
		source_canvas.height = source_height;
		capture.appendChild(source_canvas);

		config.source_canvas = source_canvas;
	}

	const di_ctx = config.source_canvas.getContext('2d', { alpha: false });

	di_ctx.putImageData(
		config.source_img,
		0,
		0,
		0,
		0,
		config.source_img.width,
		source_height
	);

	di_ctx.fillStyle = '#FFA50080';

	const x_offset = config.capture_area.x;
	const y_offset = config.capture_area.y;

	for (const name of Object.keys(data)) {
		if (config.palette && name.startsWith('color')) continue;

		const task = config.tasks[name];

		if (!task) continue;

		const holder = document.querySelector(`fieldset.${name} div.results`);

		if (!holder) {
			console.warn(
				`Config controls for [${name}] are not present on page, skipping showing part.`
			);
			continue;
		}

		const scale_factor = name.startsWith('color') ? 4 : 2;
		let separator;

		if (!task.crop_canvas_ctx) {
			// create canvas at 2x resolution to make it easier to see the areas
			const crop_canvas = document.createElement('canvas');
			crop_canvas.width = task.crop_img.width * scale_factor;
			crop_canvas.height = task.crop_img.height * scale_factor;
			holder.appendChild(crop_canvas);

			separator = document.createElement('span');
			separator.textContent = ' ⟹ ';
			holder.appendChild(separator);

			const scale_canvas = document.createElement('canvas');
			scale_canvas.width = task.scale_img.width * scale_factor;
			scale_canvas.height = task.scale_img.height * scale_factor;
			holder.appendChild(scale_canvas);

			separator = document.createElement('span');
			separator.textContent = ' ⟹ ';
			holder.appendChild(separator);

			task.crop_canvas_ctx = crop_canvas.getContext('2d', { alpha: false });
			task.scale_canvas_ctx = scale_canvas.getContext('2d', { alpha: false });

			task.crop_canvas_ctx.imageSmoothingEnabled = false;
			task.scale_canvas_ctx.imageSmoothingEnabled = false;

			if (name.startsWith('color')) {
				const color_result = document.createElement('div');
				color_result.classList.add('col_res');
				color_result.style.display = 'inline-block';
				color_result.style.width = '25px';
				color_result.style.height = '25px';

				holder.appendChild(color_result);
			} else if (name === 'field') {
				const field_result = document.createElement('canvas');
				field_result.width = 158;
				field_result.height = 318;
				field_result.classList.add('field_res');
				field_result.style.display = 'inline-block';

				const ctx = field_result.getContext('2d', { alpha: false });
				ctx.fillStyle = '#000000';
				ctx.fillRect(0, 0, 158, 318);

				holder.appendChild(field_result);
			}

			const text_result = document.createElement('pre');
			holder.appendChild(text_result);
		}

		const cropped = await createImageBitmap(
			task.crop_img,
			0,
			0,
			task.crop_img.width,
			task.crop_img.height
		);
		const scaled = await createImageBitmap(
			task.scale_img,
			0,
			0,
			task.scale_img.width,
			task.scale_img.height
		);

		// draw task captured areas at 2x scale
		task.crop_canvas_ctx.drawImage(
			cropped,
			0,
			0,
			task.crop_img.width * scale_factor,
			task.crop_img.height * scale_factor
		);
		task.scale_canvas_ctx.drawImage(
			scaled,
			0,
			0,
			task.scale_img.width * scale_factor,
			task.scale_img.height * scale_factor
		);

		// highlight captured areas in source image
		const [x, y, w, h] = task.crop;
		di_ctx.fillRect(x - x_offset, y - y_offset, w, h);

		// show text result
		if (name.startsWith('color')) {
			const color = `rgb(${data[name][0]},${data[name][1]},${data[name][2]})`;

			holder.querySelector(`.col_res`).style.backgroundColor = color;
			holder.querySelector(`pre`).textContent = color;
		} else if (name != 'field') {
			holder.querySelector(`pre`).innerHTML =
				data[name] === null ? '&nbsp;' : data[name];
		} else {
			const canvas = holder.querySelector(`.field_res`);
			const ctx = canvas.getContext('2d', { alpha: false });

			let colors;

			if (data.level != null && !isNaN(data.level)) {
				colors = ['#000000', '#ffffff', ...LEVEL_COLORS[data.level % 10]];
			} else if (data.color1) {
				colors = [
					'#000000',
					toCol(data.color1),
					toCol(data.color2),
					toCol(data.color3),
				];
			}

			canvas.hidden = !!colors;

			if (colors) {
				holder.querySelector(`pre`).textContent = '';

				for (let ridx = 0; ridx < 20; ridx++) {
					const row = data[name].slice(ridx * 10, ridx * 10 + 10);

					row.forEach((cell, cidx) => {
						ctx.fillStyle = colors[cell || 0];
						ctx.fillRect(cidx * 16, ridx * 16, 14, 14);
					});
				}
			} else {
				const rows = [];

				for (let ridx = 0; ridx < 20; ridx++) {
					const row = data[name].slice(ridx * 10, ridx * 10 + 10);
					rows.push(row.join(''));
				}

				holder.querySelector(`pre`).textContent = rows.join('\n');
			}
		}
	}
}

function toCol(col_tuple) {
	return `#${[...col_tuple]
		.map(v => v.toString(16).padStart(2, '0'))
		.join('')}`;
}

function saveConfig(config) {
	const {
		device_id,
		game_type,
		palette,
		frame_rate,
		focus_alarm,
		allow_video_feed,
		video_feed_device_id,
		brightness,
		contrast,
		score7,
		use_half_height,
		use_worker_for_interval,
		handle_retron_levels_6_7,
	} = config;

	// need to drop non-serializable fields
	const config_copy = {
		device_id,
		game_type,
		palette,
		frame_rate,
		focus_alarm,
		allow_video_feed,
		video_feed_device_id,
		brightness,
		contrast,
		score7,
		use_half_height,
		use_worker_for_interval,
		handle_retron_levels_6_7,
		tasks: {},
	};

	for (const [name, task] of Object.entries(config.tasks)) {
		config_copy.tasks[name] = {
			crop: task.crop,
			pattern: task.pattern,
			red: task.red,
		};
	}

	localStorage.setItem('config', JSON.stringify(config_copy));

	resetShowPartsTimer();
}

function hasConfig() {
	const maybeConfig = localStorage.getItem('config');
	if (!maybeConfig) return false;

	// minimal checks for validity of the config object
	// could add comprehensive verification later
	// for now guard against initial calibration not completed
	try {
		const parsed = JSON.parse(maybeConfig);
		if (parsed?.device_id === 'everdrive') return true;

		// For OCR capture, we check that the task list is valid

		if (!parsed?.tasks) return false;

		const tasks = Object.values(parsed.tasks);
		if (tasks.length <= 0) return false;
		if (!tasks.every(task => !!task.crop)) return false;
	} catch (err) {
		return false;
	}

	return true;
}

function getGameTypeFromTasks(tasks) {
	return tasks.T
		? BinaryFrame.GAME_TYPE.CLASSIC
		: tasks.cur_piece_das
			? BinaryFrame.GAME_TYPE.DAS_TRAINER
			: BinaryFrame.GAME_TYPE.MINIMAL;
}

function loadConfig() {
	const config = localStorage.getItem('config');

	if (config) {
		const parsed = JSON.parse(config);

		if (!parsed.hasOwnProperty('game_type')) {
			parsed.game_type = getGameTypeFromTasks(parsed.tasks);
		}

		return parsed;
	}
}

function showFrameData(data) {
	if (!data) return;

	// TODO: fix markup on config change, rather than destroy-rebuild at every frame
	frame_data.innerHTML = '';

	for (const [name, value] of Object.entries(data)) {
		if (name === 'raw') continue;

		const dt = document.createElement('dt');
		const dd = document.createElement('dd');

		dt.textContent = name;
		if (name === 'field') {
			if (config.device_id != 'everdrive') {
				dd.textContent = data.field.slice(0, 30).join('');
			} else {
				const rows = Array(20)
					.fill()
					.map((_, idx) => data.field.slice(idx * 10, (idx + 1) * 10).join(''));
				dd.innerHTML = `${rows.join('<br/>')}`;
			}
		} else {
			dd.textContent = value;
		}

		frame_data.appendChild(dt);
		frame_data.appendChild(dd);
	}
}

function showPerfData(perf) {
	// This reuses the dd/dt elements because we assume constant perf items at every call
	for (const [name, value] of Object.entries(perf)) {
		let dt = perf_data.querySelector(`dt.${name}`);

		if (dt) {
			const dd = dt.nextSibling;
			if (value === null) {
				dd.remove();
				dt.remove();
			} else {
				dd.textContent = value;
			}
		} else if (value !== null) {
			const dt = document.createElement('dt');
			const dd = document.createElement('dd');

			dt.classList.add(name);
			dt.textContent = name;
			dd.textContent = value;

			perf_data.appendChild(dt);
			perf_data.appendChild(dd);
		}
	}
}

function trackAndSendFrames() {
	console.log('trackAndSendFrames');
	if (show_parts.checked) {
		showConfigControls(templates, palettes, config);
	}

	game_tracker = new GameTracker(templates, palettes, config);

	let start_time = Date.now();
	let last_frame = { field: [] };

	game_tracker.onNewGame = () => {
		save_game_palette.disabled = true;
	};

	// Palette is ready to be used
	game_tracker.onPalette = () => {
		save_game_palette.palette = game_tracker.palette;
		save_game_palette.disabled = false;
	};

	// TODO: better event system and name for frame data events
	game_tracker.onMessage = async function (data) {
		data.game_type = config.game_type ?? BinaryFrame.GAME_TYPE.CLASSIC;
		data.ctime = Date.now() - start_time;

		if (show_parts.checked) {
			performance.mark('show_parts_start');
			await showParts(data.raw); // show OCR values with no processing
			performance.mark('show_parts_end');
			try {
				performance.measure('show_parts', 'show_parts_start', 'show_parts_end');
			} catch (err) {}
		}

		const perf = {};

		try {
			performance.measure('capture', 'capture_start', 'capture_end');
		} catch (err) {}

		performance.mark('show_frame_data_start');
		showFrameData(data);
		performance.mark('show_frame_data_end');
		performance.measure(
			'show_frame_data',
			'show_frame_data_start',
			'show_frame_data_end'
		);

		performance.mark('process_over');

		try {
			performance.measure('total', 'capture_start', 'process_over');
		} catch (err) {}

		performance.getEntriesByType('measure').forEach(m => {
			// discard browser performance measurements -_-
			if (m.name.startsWith('browser::')) return;
			if (m.name.startsWith('invoke-')) return;
			if (m.name.startsWith('inline-')) return;
			if (m.name.startsWith('DOM-')) return;
			if (m.name.startsWith('ANALYZE_')) return;

			perf[m.name] = m.duration.toFixed(3);
		});

		if (!show_parts.checked) {
			perf.show_parts = null;
		}

		performance.mark('show_perf_data_start');
		showPerfData(perf);
		performance.mark('show_perf_data_end');
		performance.measure(
			'show_perf_data',
			'show_perf_data_start',
			'show_perf_data_end'
		);

		showPerfData({
			show_perf_data: performance
				.getEntriesByName('show_perf_data')[0]
				.duration.toFixed(3),
		});

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
	};

	startCapture();
	resetShowPartsTimer();
}

let destroyRoomViewTO;
let roomIFrame;

function destroyRoomView() {
	roomIFrame.remove();
	window.removeEventListener('resize', resizeRoomIFrame);
	roomIFrame = null;
}

function getLayout(layout) {
	return layout && /^[a-z0-9_]+$/.test(layout) ? layout : null;
}

function getViewURL() {
	const producer_url = new URL(document.location);
	const searchParams = new URLSearchParams();

	let mainViewLayout;

	if (view_meta) {
		mainViewLayout = getLayout(view_meta._layout);

		// add remote view settings (all except private keys)
		Object.entries(view_meta)
			.filter(([key, _]) => !key.startsWith('_'))
			.forEach(([key, value]) => searchParams.set(key, value));
	}

	const newPathname = producer_url.pathname.replace(
		/\/producer$/,
		`/view/${mainViewLayout || 'ctwc23'}`
	);

	// add specific settings
	searchParams.set('tetris_sound', 0);
	searchParams.set('video', 0);
	searchParams.set('bg', 0);
	searchParams.set('simultris', 0);
	searchParams.set('srabbit', 0);
	// disable commentator bot, unless the player has specifically activated it
	searchParams.set('combot', QueryString.get('combot') === '1' ? '1' : '0');
	searchParams.set('in_producer', 1);

	return `${producer_url.origin}${newPathname}?${searchParams}`;
}

function loadRoomView() {
	if (!is_match_room) {
		console.warn('View in private room is not supported');
		return;
	}

	const view_url = getViewURL();

	if (roomIFrame) {
		if (roomIFrame.getAttribute('src') === view_url) return; // same view, nothing to do

		// there's already an iframe, but we need to reload the correct layout
		// clear first and fall through
		destroyRoomView();
	}

	const iFrameStyles = {
		border: 0,
		margin: 'auto',
		transformOrigin: `0 0`,
	};

	roomIFrame = document.createElement('iframe');
	Object.assign(roomIFrame.style, iFrameStyles);
	roomIFrame.setAttribute('src', view_url);

	if (view_meta?._size === '720') {
		roomIFrame.setAttribute('width', 1280);
		roomIFrame.setAttribute('height', 720);
	} else if (view_meta?._size === '750') {
		roomIFrame.setAttribute('width', 1334);
		roomIFrame.setAttribute('height', 750);
	} else {
		roomIFrame.setAttribute('width', 1920);
		roomIFrame.setAttribute('height', 1080);
	}

	resizeRoomIFrame();

	room.querySelector('.view').appendChild(roomIFrame);

	window.addEventListener('resize', resizeRoomIFrame);
}

function resizeRoomIFrame() {
	if (!roomIFrame) return;

	const size =
		view_meta?._size === '720'
			? 1280
			: view_meta?._size === '750'
				? 1334
				: 1920;

	if (room.clientWidth >= size) {
		if (!roomIFrame.style.transform) return;
		roomIFrame.style.transform = null;
	} else {
		const scale = room.clientWidth / size;
		roomIFrame.style.transform = `scale(${scale})`;
	}
}

function removeCalibrationTab() {
	[...tabs].find(tab => tab.dataset.target === 'calibration').remove();
	document.getElementById('calibration').remove();
}

function initTabControls() {
	if (!is_match_room) {
		// remove the room tab
		[...tabs].find(tab => tab.dataset.target === 'room').remove();
		room.remove();
	}

	tabContents.forEach(box => box.classList.add('is-hidden'));

	tabs.forEach(tab => {
		tab.addEventListener('click', () => {
			tabs.forEach(tab => tab.classList.remove('is-active'));
			tab.classList.add('is-active');

			const target = tab.dataset.target;
			tabContents.forEach(box => {
				if (box.getAttribute('id') === target) {
					box.classList.remove('is-hidden');
				} else {
					box.classList.add('is-hidden');
				}
			});

			if (target === 'room') {
				destroyRoomViewTO = clearTimeout(destroyRoomViewTO);
				loadRoomView();
			} else if (roomIFrame) {
				destroyRoomViewTO = setTimeout(destroyRoomView, 15000); // 15 seconds to allow users to click around
			}
		});
	});
}

function showProducerUI() {
	wizard.classList.add('is-hidden');
	tabsContainer.classList.remove('is-hidden');
	tabContentsContainer.classList.remove('is-hidden');
}

// the 2 candidates timer systems
const stdTimer = {
	setInterval: setInterval.bind(window),
	clearInterval: clearInterval.bind(window),
};

const workerTimer = {
	callid: 0,
	callbacks: {},
	worker: null,
	setInterval: function (callback, ms) {
		this.callbacks[++this.callid] = callback;
		this.worker.postMessage(['setInterval', ms, this.callid]);
		return this.callid;
	},
	clearInterval: function (id) {
		delete this.callbacks[id];
		this.worker.postMessage(['clearInterval', id]);
	},
	init: function () {
		return new Promise(resolve => {
			const blob = new Blob([worker_script], { type: 'text/javascript' });
			this.worker = new Worker(window.URL.createObjectURL(blob));

			const handleWorkerMessage = e => {
				const [cmd, ...args] = e.data;
				if (cmd === 'interval') {
					const [callid] = args;
					this.callbacks[callid]?.();
				}
			};

			const handleWorkerInit = () => {
				this.worker.removeEventListener('message', handleWorkerInit);
				this.worker.addEventListener('message', handleWorkerMessage);
				resolve();
			};

			// by convention the first message is guaranteed to be the init message, so we don't need to check the details
			this.worker.addEventListener('message', handleWorkerInit);
		});
	},
};

const worker_script = `
	idMap = {};
	onmessage = e => {
		const [cmd, ...args] = e.data;
		if (cmd === 'setInterval') {
			const [interval, callid] = args;
			idMap[callid] = setInterval(() => {
				postMessage(['interval', callid]);
			}, interval);
		}
		else if (cmd === 'clearInterval') {
			const [callid] = args;
			delete idMap[callid];
			clearInterval(callid);
		}
	};
	postMessage(['init']);
`;

// the timer 'smile' we can atomically swap
let timer = stdTimer;

(async function init() {
	// unfortunate bootstrap delay, but makes everything else simpler later on
	await workerTimer.init();

	initTabControls();

	// check if timer should be made visible
	if (QueryString.get('timer') === '1') {
		timer_control.classList.remove('is_hidden');
	}

	// load external assets - could parrallelize
	templates = await loadDigitTemplates();
	palettes = await loadPalettes();

	// showTemplates(templates);

	await updatePaletteList();

	if (hasConfig()) {
		config = loadConfig();

		// transformation of color numbers for old configs
		// TODO: delete when everyone is using the new config
		if (config.tasks.color1 && !config.tasks.color3) {
			config.tasks.color3 = config.tasks.color2;
			config.tasks.color2 = config.tasks.color1;

			delete config.tasks.color1;
		}

		await resetDevices();

		capture_rate.value = config.frame_rate || default_frame_rate;

		let tmp_use_half_height = QueryString.get('disable_half_height') !== '1';

		if ('use_half_height' in config) {
			tmp_use_half_height = !!config.use_half_height;
		}

		score7.checked = config.score7 === true;
		use_half_height.checked = tmp_use_half_height;
		allow_video_feed.checked = config.allow_video_feed != false;
		focus_alarm.checked = config.focus_alarm != false;
		use_worker_for_interval.checked = config.use_worker_for_interval != false;
		handle_retron_levels_6_7.checked = config.handle_retron_levels_6_7 != false;

		if (use_worker_for_interval.checked) {
			console.log('Utilizing Worker Timer');
			timer = workerTimer;
		}

		const brightness = config.brightness === undefined ? 1 : config.brightness;
		brightness_slider.value = config.brightness = brightness;
		brightness_value.textContent = brightness.toFixed(2);

		const contrast = config.contrast === undefined ? 1 : config.contrast;
		contrast_slider.value = config.contrast = contrast;
		contrast_value.textContent = contrast.toFixed(2);

		updateImageCorrection();

		if (config.device_id === 'everdrive') {
			removeCalibrationTab();
			initCaptureFromEverdrive(config.frame_rate);
		} else {
			if (config.device_id === 'window') {
				config.use_half_height = false;
				use_half_height.checked = false;
				use_half_height.parentNode.remove();
			}

			await playVideoFromConfig();
			trackAndSendFrames();
		}

		tabs[1].click(); // data tab
		showProducerUI();
	} else {
		await resetDevices();

		capture_rate.value = default_frame_rate;

		// create default dummy waiting to be populated by user selection
		config = {
			frame_rate: default_frame_rate,
			tasks: {},
		};

		video.classList.add('is-hidden');
		wizard.append(video);
		wizard.classList.remove('is-hidden');

		// TODO: await completion of the calibration before connecting
	}

	// we connect last so UI is ready before we try to send any data or video feed
	connect();
})();
