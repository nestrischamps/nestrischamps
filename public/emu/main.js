import { MarcFile, parseBPSFile } from '/emu/bps.js';
import { address_maps, getDataAddresses } from '/emu/addresses.js';
import Connection from '/js/connection.js';
import BinaryFrame from '/js/BinaryFrame.js';
import EDGameTracker from '/producer/EDGameTracker.js';

// ========== Global Application State ==========

let g_pending_frames = 0;
let g_frames_since_last_fps_count = 0;
let g_rendered_frames = [];

let g_last_frame_sample_count = 44100 / 60; // Close-ish enough
let g_audio_samples_buffered = 0;
let g_new_frame_sample_threshold = 4096; // under which we request a new frame
let g_audio_overrun_sample_threshold = 8192; // over which we *drop* samples

let g_game_checksum = -1;

let g_screen_buffers = [];
let g_next_free_buffer_index = 0;
let g_last_rendered_buffer_index = 0;
let g_total_buffers = 16;

let g_frameskip = 0;
let g_frame_delay = 0;

let g_audio_confirmed_working = false;
let g_profiling_results = {};

let g_trouble_detector = {
	successful_samples: 0,
	failed_samples: 0,
	frames_requested: 0,
	trouble_count: 0,
	got_better_count: 0,
};

let g_increase_frameskip_threshold = 0.01; // percent of missed samples
let g_decrease_frameskip_headroom = 1.5; // percent of the time taken to render one frame

let g_gymFile = null;
let g_gym_addresses = getDataAddresses(address_maps.gym6);

const g_connection = new Connection();
const g_edGameTracker = new EDGameTracker();

const API = {
	makePlayer(player_index, _view_meta) {
		// producer is player, anyway to show the room view?
	},

	dropPlayer() {},

	setVdoNinjaURL(url) {
		if (url) {
			// document.querySelector('#vdoninja_url').textContent = url;

			url = new URL(url);

			const streamId =
				url.searchParams.get('view') || u.searchParams.get('push');

			url.searchParams.delete('view');
			url.searchParams.set('push', streamId);
			url.searchParams.set('webcam', 1);
			url.searchParams.set('audiodevice', 0);
			url.searchParams.set('autostart', 1);

			cb_vdoninja.checked = true;
			document.querySelector('#vdoninja').src = url.toString();
		}
	},
};

let last_frame = { field: [] };

g_connection.onMessage = function (frame) {
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

g_edGameTracker.addEventListener('frame', ({ detail: data }) => {
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
		if (data.ctime - last_frame.ctime >= 1000) break; // max 1fps heartbeat

		// no need to send frame
		return;
	} while (false);

	last_frame = data;
	g_connection.send(BinaryFrame.encode(data));
});

// ========== Init which does not depend on DOM ========

for (let i = 0; i < g_total_buffers; i++) {
	// Allocate a good number of screen buffers
	g_screen_buffers[i] = new ArrayBuffer(256 * 240 * 4);
}

// ========== Worker Setup and Utility ==========

let worker;

// the base64 functions below cannot handle very large payloads, but for nes roms and sram, they will do just fine
function bytesToBase64(bytes) {
	return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(str) {
	return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function rpc(task, args) {
	return new Promise((resolve, reject) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = ({ data }) => {
			if (data.error) {
				reject(data.error);
			} else {
				resolve(data.result);
			}
		};
		worker.postMessage({ type: 'rpc', func: task, args: args }, [
			channel.port2,
		]);
	});
}

function startWorker() {
	worker = new Worker('/emu/emu_worker.js');

	worker.onmessage = function (e) {
		if (e.data.type == 'init') {
			onready();
			return;
		}

		if (e.data.type == 'deliverFrame') {
			if (e.data.panels.length > 0) {
				g_rendered_frames.push(e.data.panels);
				for (let panel of e.data.panels) {
					if (panel.id == 'screen') {
						g_screen_buffers[g_last_rendered_buffer_index] = panel.image_buffer;
					}
				}
				g_last_rendered_buffer_index += 1;
				if (g_last_rendered_buffer_index >= g_total_buffers) {
					g_last_rendered_buffer_index = 0;
				}
				g_frames_since_last_fps_count += 1;
			}
			g_pending_frames -= 1;
			if (g_audio_samples_buffered < g_audio_overrun_sample_threshold) {
				g_nes_audio_node.port.postMessage({
					type: 'samples',
					samples: e.data.audio_buffer,
				});
				g_audio_samples_buffered += e.data.audio_buffer.length;
				g_last_frame_sample_count = e.data.audio_buffer.length;
			} else {
				// Audio overrun, we're running too fast! Drop these samples on the floor and bail.
				// (This can happen in fastforward mode.)
			}
			if (g_rendered_frames.length > 3) {
				// Frame rendering running behing, dropping one frame
				g_rendered_frames.shift(); // and throw it away
			}

			g_edGameTracker.processFrame(e.data.mem_values);
		}

		if (e.data.type == 'reportPerformance') {
			g_profiling_results[e.data.event] = e.data.average_milliseconds;
		}
	};
}

function render_profiling_results() {
	let results = '';
	for (let event_name in g_profiling_results) {
		let time = g_profiling_results[event_name].toFixed(2);
		results += `${event_name}: ${time}\n`;
	}
	var results_box = document.querySelector('#profiling-results');
	if (results_box != null) {
		results_box.innerHTML = results;
	}
}

function automatic_frameskip() {
	// first off, do we have enough profiling data collected?
	if (g_trouble_detector.frames_requested >= 60) {
		let audio_fail_percent =
			g_trouble_detector.failed_samples / g_trouble_detector.successful_samples;
		if (g_frameskip < 2) {
			// if our audio context is running behind, let's try
			// rendering fewer frames to compensate
			if (audio_fail_percent > g_increase_frameskip_threshold) {
				g_trouble_detector.trouble_count += 1;
				g_trouble_detector.got_better_count = 0;
				console.log('Audio failure percentage: ', audio_fail_percent);
				console.log(
					'Trouble count incremented to: ',
					g_trouble_detector.trouble_count
				);
				if (g_trouble_detector.trouble_count > 3) {
					// that's quite enough of that
					g_frameskip += 1;
					g_trouble_detector.trouble_count = 0;
					console.log('Frameskip increased to: ', g_frameskip);
					console.log('Trouble reset');
				}
			} else {
				// Slowly recover from brief trouble spikes
				// without taking action
				if (g_trouble_detector.trouble_count > 0) {
					g_trouble_detector.trouble_count -= 1;
					console.log(
						'Trouble count relaxed to: ',
						g_trouble_detector.trouble_count
					);
				}
			}
		}
		if (g_frameskip > 0) {
			// Perform a bunch of sanity checks to see if it looks safe to
			// decrease frameskip.
			if (audio_fail_percent < g_increase_frameskip_threshold) {
				// how long would it take to render one frame right now?
				let frame_render_cost = g_profiling_results.render_all_panels;
				let cost_with_headroom =
					frame_render_cost * g_decrease_frameskip_headroom;
				// Would a full render reliably fit in our idle time?
				if (cost_with_headroom < g_profiling_results.idle) {
					console.log('Frame render costs: ', frame_render_cost);
					console.log('With headroom: ', cost_with_headroom);
					console.log('Idle time currently: ', g_profiling_results.idle);
					g_trouble_detector.got_better_count += 1;
					console.log(
						'Recovery count increased to: ',
						g_trouble_detector.got_better_count
					);
				}
				if (cost_with_headroom > g_profiling_results.idle) {
					if (g_trouble_detector.got_better_count > 0) {
						g_trouble_detector.got_better_count -= 1;
						console.log(
							'Recovery count decreased to: ',
							g_trouble_detector.got_better_count
						);
					}
				}
				if (g_trouble_detector.got_better_count >= 10) {
					g_frameskip -= 1;
					console.log('Performance recovered! Lowering frameskip by 1 to: ');
					g_trouble_detector.got_better_count = 0;
				}
			}
		}

		// now reset the counters for the next run
		g_trouble_detector.frames_requested = 0;
		g_trouble_detector.failed_samples = 0;
		g_trouble_detector.successful_samples = 0;
	}
}

// ========== Audio Setup ==========

let g_audio_context = null;
let g_nes_audio_node = null;

async function init_audio_context() {
	g_audio_context = new AudioContext({
		latencyHint: 'interactive',
		sampleRate: 44100,
	});
	await g_audio_context.audioWorklet.addModule('/emu/audio_processor.js');
	g_nes_audio_node = new AudioWorkletNode(
		g_audio_context,
		'nes-audio-processor'
	);
	g_nes_audio_node.connect(g_audio_context.destination);
	g_nes_audio_node.port.onmessage = handle_audio_message;
}

function handle_audio_message(e) {
	if (e.data.type == 'samplesPlayed') {
		g_audio_samples_buffered -= e.data.count;
		g_trouble_detector.successful_samples += e.data.count;
		if (
			!g_audio_confirmed_working &&
			g_trouble_detector.successful_samples > 44100
		) {
			let audio_context_banner = document.querySelector(
				'#audio-context-warning'
			);
			if (audio_context_banner != null) {
				audio_context_banner.classList.remove('active');
			}
			g_audio_confirmed_working = true;
		}
	}
	if (e.data.type == 'audioUnderrun') {
		g_trouble_detector.failed_samples += e.data.count;
	}
}

// ========== Main ==========

function onVdoNinjaChange() {
	const iframe = document.querySelector('#vdoninja');

	if (document.querySelector('#cb_vdoninja')?.checked) {
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

		g_connection.send(['setVdoNinjaURL', viewURL]);
		navigator.clipboard.writeText(viewURL);

		/*
		document.querySelector(
			'#vdoninja_url'
		).textContent = `${viewURL} (URL has been copied to clipboard)`;
		/**/

		// 2. cancel peerjs video
		allow_video_feed.checked = false;
		onPrivacyChanged();
	} else {
		iframe.src = '';
		g_connection.send(['setVdoNinjaURL', '']);
		document.querySelector('#vdoninja_url').textContent = '';
	}
}

async function onready() {
	// Initialize audio context, this will also begin audio playback
	await init_audio_context();

	// Initialize everything else
	init_game_ui_events();
	initializeButtonMappings();

	// Kick off the events that will drive emulation
	requestAnimationFrame(renderLoop);
	// run the scheduler as often as we can. It will frequently decide not to schedule things, this is fine.
	//window.setInterval(schedule_frames_at_top_speed, 1);
	window.setTimeout(sync_to_audio, 1);
	window.setInterval(compute_fps, 1000);
	window.setInterval(render_profiling_results, 1000);
	window.setInterval(automatic_frameskip, 1000);
	window.setInterval(save_sram_periodically, 10000);

	// load gym
	load_cartridge(g_gymFile._u8array);
}

function init_main_ui_events() {
	var buttons = document.querySelectorAll('#main_menu button');
	buttons.forEach(function (button) {
		button.addEventListener('click', clickTab);
	});

	document
		.querySelector('#cb_vdoninja')
		?.addEventListener('change', onVdoNinjaChange);
}

function init_game_ui_events() {
	window.addEventListener('click', function () {
		// Needed to play audio in certain browsers, notably Chrome, which restricts playback until user action.
		g_audio_context.resume();
	});

	document
		.querySelector('#playfield')
		.addEventListener('dblclick', enterFullscreen);
	window.addEventListener('resize', handleFullscreenSwitch);

	register_touch_button('#button_a');
	register_touch_button('#button_b');
	register_touch_button('#button_ab');
	register_touch_button('#button_select');
	register_touch_button('#button_start');
	register_d_pad('#d_pad');
	initialize_touch('#playfield');

	handleFullscreenSwitch();
}

// ========== Cartridge Management ==========

async function load_cartridge(cart_data /*uint8array*/) {
	console.log('Attempting to load cart with length: ', cart_data.length);
	await rpc('load_cartridge', [cart_data]);
	console.log('Cart data loaded?');

	g_game_checksum = crc32(cart_data);
	load_sram();
	let power_light = document.querySelector('#power_light #led');
	power_light.classList.add('powered');
}

// ========== Emulator Runtime ==========

function schedule_frames_at_top_speed() {
	if (g_pending_frames < 10) {
		requestFrame();
	}
	window.setTimeout(schedule_frames_at_top_speed, 1);
}

function sync_to_audio() {
	// On mobile browsers, sometimes window.setTimeout isn't called often enough to reliably
	// queue up single frames; try to catch up by up to 4 of them at once.
	for (let i = 0; i < 4; i++) {
		// Never, for any reason, request more than 10 frames at a time. This prevents
		// the message queue from getting flooded if the emulator can't keep up.
		if (g_pending_frames < 10) {
			const actual_samples = g_audio_samples_buffered;
			const pending_samples = g_pending_frames * g_last_frame_sample_count;
			if (actual_samples + pending_samples < g_new_frame_sample_threshold) {
				requestFrame();
			}
		}
	}
	window.setTimeout(sync_to_audio, 1);
}

function requestFrame() {
	updateTouchKeys();
	g_trouble_detector.frames_requested += 1;
	if (g_frame_delay > 0) {
		// frameskip: advance the emulation, but do not populate or render
		// any panels this time around
		worker.postMessage({
			type: 'requestFrame',
			p1: keys[1] | touch_keys[1],
			p2: keys[2] | touch_keys[2],
			mem_peek: g_gym_addresses,
			panels: [],
		});
		g_frame_delay -= 1;
		g_pending_frames += 1;
		return;
	}

	worker.postMessage(
		{
			type: 'requestFrame',
			p1: keys[1] | touch_keys[1],
			p2: keys[2] | touch_keys[2],
			mem_peek: g_gym_addresses,
			panels: [
				{
					id: 'screen',
					target_element: '#pixels',
					dest_buffer: g_screen_buffers[g_next_free_buffer_index],
				},
			],
		},
		[g_screen_buffers[g_next_free_buffer_index]]
	);

	g_pending_frames += 1;
	g_next_free_buffer_index += 1;
	if (g_next_free_buffer_index >= g_total_buffers) {
		g_next_free_buffer_index = 0;
	}
	g_frame_delay = g_frameskip;
}

function renderLoop() {
	if (g_rendered_frames.length > 0) {
		for (let panel of g_rendered_frames.shift()) {
			const typed_pixels = new Uint8ClampedArray(panel.image_buffer);
			// TODO: don't hard-code the panel size here
			const rendered_frame = new ImageData(
				typed_pixels,
				panel.width,
				panel.height
			);
			const canvas = document.querySelector(panel.target_element);
			const ctx = canvas.getContext('2d', { alpha: false });
			ctx.putImageData(rendered_frame, 0, 0);
			ctx.imageSmoothingEnabled = false;
		}
	}

	requestAnimationFrame(renderLoop);
}

// ========== SRAM Management ==========

// CRC32 checksum generating functions, yanked from this handy stackoverflow post and modified to work with arrays:
// https://stackoverflow.com/questions/18638900/javascript-crc32
// Used to identify .nes files semi-uniquely, for the purpose of saving SRAM
var makeCRCTable = function () {
	var c;
	var crcTable = [];
	for (var n = 0; n < 256; n++) {
		c = n;
		for (var k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		crcTable[n] = c;
	}
	return crcTable;
};

var crc32 = function (byte_array) {
	var crcTable = window.crcTable || (window.crcTable = makeCRCTable());
	var crc = 0 ^ -1;

	for (var i = 0; i < byte_array.length; i++) {
		crc = (crc >>> 8) ^ crcTable[(crc ^ byte_array[i]) & 0xff];
	}

	return (crc ^ -1) >>> 0;
};

async function load_sram() {
	if (await rpc('has_sram')) {
		try {
			var sram_str = window.localStorage.getItem(g_game_checksum);
			if (sram_str) {
				await rpc('set_sram', [base64ToBytes(sram_str)]);
				console.log('SRAM Loaded!', g_game_checksum);
			}
		} catch (e) {
			console.log(
				'Local Storage is probably unavailable! SRAM saving and loading will not work.'
			);
		}
	}
}

async function save_sram() {
	if (await rpc('has_sram')) {
		try {
			const sram_uint8 = await rpc('get_sram', []);
			// Make it a normal array
			window.localStorage.setItem(g_game_checksum, bytesToBase64(sram_uint8));
			console.log('SRAM Saved!', g_game_checksum);
		} catch (e) {
			console.log(
				'Local Storage is probably unavailable! SRAM saving and loading will not work.'
			);
		}
	}
}

function save_sram_periodically() {
	save_sram();
}

// ========== User Interface ==========

// This runs *around* once per second, ish. It's fine.
function compute_fps() {
	let counter_element = document.querySelector('#fps-counter');
	if (counter_element != null) {
		counter_element.innerText = 'FPS: ' + g_frames_since_last_fps_count;
	}
	g_frames_since_last_fps_count = 0;
}

function hideAllTabs() {
	[...document.querySelectorAll('#main_menu button')].forEach(
		btn => (btn.parentElement.style.display = 'none')
	);
}

function showAllTabs() {
	[...document.querySelectorAll('#main_menu button')].forEach(
		btn => (btn.parentElement.style.display = null)
	);
}

function clearTabs() {
	const buttons = document.querySelectorAll('#main_menu button');
	buttons.forEach(function (button) {
		button.classList.remove('active');
	});

	const tabs = document.querySelectorAll('div.tab_content');
	tabs.forEach(function (tab) {
		tab.classList.remove('active');
	});
}

function switchToTab(tab_name) {
	clearTabs();

	const tab_elements = document.getElementsByName(tab_name);
	tab_elements[0]?.classList.add('active');

	const content_element = document.getElementById(tab_name);
	content_element?.classList.add('active');
}

function clickTab() {
	const tabName = this.getAttribute('name');

	if (tabName == 'fullscreen') {
		switchToTab('playfield');
		enterFullscreen();
	} else {
		switchToTab(tabName);
	}
}

function enterFullscreen() {
	var viewport = document.querySelector('#playfield');
	(
		viewport.requestFullscreen ||
		viewport.mozRequestFullScreen ||
		viewport.webkitRequestFullscreen
	).call(viewport);
}

function isFullScreen() {
	return !!(
		document.fullscreenElement ||
		document.mozFullScreenElement ||
		document.webkitFullscreenElement ||
		document.msFullscreenElement
	);
}

function handleFullscreenSwitch() {
	const viewport = document.querySelector('#playfield');
	const canvas_container = viewport.querySelector('div.canvas_container');

	if (isFullScreen()) {
		console.log('Entering fullscreen...');
		// Entering fullscreen
		viewport.classList.add('fullscreen');
		viewport.classList.remove('horizontal', 'vertical');
		if (is_touch_detected) {
			viewport.classList.add('touchscreen');
		} else {
			viewport.classList.remove('touchscreen');
		}
	} else {
		// Exiting fullscreen
		console.log('Exiting fullscreen...');
		viewport.classList.remove(
			'fullscreen',
			'touchscreen',
			'horizontal',
			'vertical'
		);
		canvas_container.style.width = '';
		canvas_container.style.height = '';
	}

	const viewport_width = viewport.clientWidth;
	const viewport_height = viewport.clientHeight;
	const viewport_ratio = viewport_width / viewport_height;
	const target_ratio = 256 / 240;

	let target_height, target_width;

	if (viewport_ratio > target_ratio) {
		target_height = viewport_height;
		target_width = target_height * target_ratio;
		viewport.classList.add('horizontal');
	} else {
		target_width = viewport_width;
		target_height = target_width / target_ratio;
		viewport.classList.add('vertical');
	}

	canvas_container.style.width = target_width + 'px';
	canvas_container.style.height = target_height + 'px';
}

function hide_banners() {
	banner_elements = document.querySelectorAll('.banner');
	banner_elements.forEach(function (banner) {
		banner.classList.remove('active');
	});
}

function display_banner(cartridge_name) {
	hide_banners();
	banner_elements = document.getElementsByName(cartridge_name);
	if (banner_elements.length == 1) {
		banner_elements[0].classList.add('active');
	}
}

// ========== NTC rom management ==========

function showOpenFilePickerPolyfill(options) {
	return new Promise(resolve => {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = options.multiple;
		if (options.types) {
			input.accept = options.types
				.map(type => type.accept)
				.flatMap(inst => Object.keys(inst).flatMap(key => inst[key]))
				.join(',');
		}

		// See https://stackoverflow.com/questions/47664777/javascript-file-input-onchange-not-working-ios-safari-only
		input.style.position = 'fixed';
		input.style.top = '-100000px';
		input.style.left = '-100000px';
		document.body.appendChild(input);

		input.addEventListener('change', () => {
			resolve(
				[...input.files].map(file => {
					return {
						getFile: async () =>
							new Promise(resolve => {
								resolve(file);
							}),
					};
				})
			);
		});

		input.click();
	});
}

if (typeof window.showOpenFilePicker !== 'function') {
	window.showOpenFilePicker = showOpenFilePickerPolyfill;
}

const patch_url = '/emu/TetrisGYM-6.0.0.bps';

let emulator;

function initFirstTime() {
	// Make the user to perform the only action that matters at this point: selecting the tetris rom
	// Hide controls and banners
	hideAllTabs();
	document.querySelector('#fps-counter').style.display = 'none';
	document.querySelector('.banner.active').classList.remove('active');

	// show just the menu element we want
	document.querySelector(
		'#main_menu button[name=setup]'
	).parentElement.style.display = null;
	document.querySelector(
		'#main_menu button[name=credits]'
	).parentElement.style.display = null;

	switchToTab('setup');

	const button = document.querySelector('#setup button');

	button.addEventListener('click', async () => {
		document.querySelector('#setup .error').innerHTML = '&nbsp;';

		const [fileHandle] = await showOpenFilePicker({
			multiple: false,
		});
		const file = await fileHandle.getFile();
		const content = new Uint8Array(await file.arrayBuffer());

		patchVanillaRomAndStart(content);
	});
}

async function patchVanillaRomAndStart(romContent) {
	// fetch patch - store patch in local storage?
	const response = await fetch(patch_url);
	const patchContent = await response.arrayBuffer();

	const romFile = new MarcFile(romContent);
	const patchFile = new MarcFile(patchContent);

	const bps = parseBPSFile(patchFile);

	try {
		g_gymFile = bps.apply(romFile, true);
	} catch (err) {
		const error = document.querySelector('#setup .error');

		if (err.message === 'error_crc_input') {
			error.textContent = 'Checksum does not match, invalid rom provided.';
		} else {
			error.textContent = `Unexpected patch error: ${err.message}`;
		}

		return;
	}

	// if we reach here, patching is OK, attempt to save the rom, but ignore if unable to
	try {
		localStorage.setItem('tetris.nes', bytesToBase64(romContent));
	} catch (err) {
		console.warn(
			`Unable to save tetris rom to local storage. You will need to provide the rom again if you refresh.`,
			err
		);
	}

	document.querySelector('.setup').remove();

	showAllTabs();
	document.querySelector('#fps-counter').style.display = null;

	switchToTab('playfield');

	startWorker();
}

function run() {
	init_main_ui_events();

	const encoded64VanillaRomContent = localStorage.getItem('tetris.nes');
	if (!encoded64VanillaRomContent) {
		initFirstTime();
	} else {
		patchVanillaRomAndStart(base64ToBytes(encoded64VanillaRomContent));
	}
}

run();
