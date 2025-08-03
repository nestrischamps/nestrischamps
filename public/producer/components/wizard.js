import BinaryFrame from '/js/BinaryFrame.js';
import { html } from '../StringUtils.js';
import {
	getConnectedDevices,
	playVideoFromDevice,
	playVideoFromScreenCap,
} from '../MediaUtils.js';
import { appStore } from '../AppStore.js';
import { NtcComponent } from './NtcComponent.js';
import {
	CONFIGS,
	REFERENCE_SIZE,
	REFERENCE_LOCATIONS,
	RETRON_HD_CONFIG,
} from '../constants.js';
import loadPalettes from '../../ocr/palettes.js';
import {
	getFieldCoordinates,
	getCaptureCoordinates,
} from '../../ocr/calibration.js';
import { getDefaultOcrConfig, saveConfig } from '../ConfigUtils.js';
import { sleep } from '../timer.js';

function css_size(css_pixel_width) {
	return parseFloat(css_pixel_width.replace(/px$/, ''));
}

function updateCanvasSizeIfNeeded(canvas, w, h) {
	if (canvas.width != w || canvas.height != h) {
		canvas.width = w;
		canvas.height = h;

		// must restore no smoothing after change of size
		canvas.getContext('2d', { alpha: false }).imageSmoothingEnabled = false;
	}
}

const MARKUP = html`
	<div id="wizard" class="container" class="is-max-widescreen">
		<fieldset>
			<legend>Wizard</legend>
			<div class="field is-horizontal">
				<div class="field-label is-normal">
					<label class="label" for="device">Capture Method / Device</label>
				</div>

				<div class="field-body">
					<div class="field is-narrow">
						<div class="control">
							<div class="select is-fullwidth">
								<select id="device"></select>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div class="field is-horizontal">
				<div class="field-label is-normal">
					<label class="label" for="rom">ROM</label>
				</div>

				<div class="field-body">
					<div class="field is-narrow">
						<div class="control">
							<div class="select is-fullwidth">
								<select id="rom">
									<option value="">-</option>
									<option
										value="classic"
										title="Minimal + Colors and Piece stats"
									>
										Classic
									</option>
									<option value="das_trainer" title="Minimal + DAS stats">
										Das Trainer
									</option>
									<option
										value="minimal"
										title="Capture score, level, lines, preview and field"
									>
										Minimal
									</option>
									<option
										value="retron_hdmi_169_classic"
										title="Capture from a Retron with 16:9 aspect ratio"
									>
										Retron HDMI 16:9 (classic)
									</option>
									<option
										value="retron_hdmi_43_classic"
										title="Capture from a Retron with 4:3 aspect ratio"
									>
										Retron HDMI 4:3 (classic)
									</option>
									<option
										value="retron_hdmi_169_minimal"
										title="Capture from a Retron with 16:9 aspect ratio"
									>
										Retron HDMI 16:9 (minimal)
									</option>
									<option
										value="retron_hdmi_43_minimal"
										title="Capture from a Retron with 4:3 aspect ratio"
									>
										Retron HDMI 4:3 (minimal)
									</option>
								</select>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div class="field is-horizontal is-hidden" id="color_matching">
				<div class="field-label is-normal">
					<label class="label" for="palette">Color matching</label>
				</div>

				<div class="field-body">
					<div class="field is-narrow">
						<div class="control">
							<div class="select is-fullwidth">
								<select id="palette"></select>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div id="instructions" class="content notification is-warning is-hidden">
				<h1 class="title">Please read these next-steps instructions!</h1>
				<ol start="1">
					<li>
						With your selection above, your tetris capture should now be visible
						in the video element below
					</li>
					<li>
						Start a game <strong>at level 0</strong>, and in the video below,
						click somewhere BLACK in the central Tetris field.
					</li>
				</ol>
			</div>

			<div id="video_container" class="is-hidden">
				<div
					class="container is-flex is-justify-content-center is-align-items-center is-hidden"
				>
					<video id="video" autoplay playsinline></video>
				</div>
			</div>
		</fieldset>
	</div>
`;

export class NTC_Producer_Wizard extends NtcComponent {
	#domrefs = null;
	#pending_calibration = false; // we store the ref of interests

	constructor() {
		super();

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {
			device_selector: this.shadow.getElementById('device'),
			palette_selector: this.shadow.getElementById('palette'),
			rom_selector: this.shadow.getElementById('rom'),
			color_matching: this.shadow.getElementById('color_matching'),
			instructions: this.shadow.getElementById('instructions'),
			video_container: this.shadow.getElementById('video_container'),
			video: this.shadow.getElementById('video'),
		};

		this.#domrefs.palette_selector.disabled = true;
		this.#domrefs.video.controls = false;
		this.#domrefs.video.style.cursor = 'crosshair';

		this.#domrefs.device_selector.addEventListener(
			'change',
			this.#deviceSelectorChange
		);
		this.#domrefs.rom_selector.addEventListener(
			'change',
			this.#romSelectorChange
		);
		this.#domrefs.video.addEventListener('click', this.#videoClick);

		this.#updatePaletteList();
	}

	async #updatePaletteList() {
		const { palette_selector } = this.#domrefs;

		const palettes = await loadPalettes();

		console.log({ palettes });

		palette_selector.replaceChildren(
			...[
				{
					label: 'Read from frame',
					value: '',
				},
				...Object.keys(palettes).map(value => ({
					label: `${value} palette`,
					value,
				})),
			].map(option => {
				const palette_option = document.createElement('option');
				palette_option.text = option.label;
				palette_option.value = option.value;

				return palette_option;
			})
		);
	}

	#deviceSelectorChange = event => {
		const { device_selector, video_container, video } = this.#domrefs;

		const device_id = device_selector.value;

		if (device_id === 'everdrive') {
			this.#finalizeEverdriveConfig();
			return;
		} else {
			this.#stopVideo();

			if (device_id === 'window') {
				video.ntcType = 'screencap';
				playVideoFromScreenCap(video);
			} else if (device_id !== '') {
				video.ntcType = 'device';
				playVideoFromDevice(video, device_id);
			}
		}

		video_container.classList[
			device_id === 'everdrive' && device_id !== '' ? 'add' : 'remove'
		]('is-hidden');
	};

	#romSelectorChange = async event => {
		const { rom_selector, palette_selector, color_matching } = this.#domrefs;

		const first_option = palette_selector.querySelector('option:first-child');

		function hideAndResetColorMatching() {
			color_matching.classList.add('is-hidden');
			palette_selector.disabled = true;
		}

		const palettes = await loadPalettes();

		palette_selector.value = palettes._saved ? '_saved' : '';

		if (rom_selector.value === '') {
			hideAndResetColorMatching();
		} else if (/^retron_/.test(rom_selector.value)) {
			this.#finalizeRetronConfig(rom_selector.value);
			return;
		} else {
			const game_type = CONFIGS[rom_selector.value].game_type;

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

		this.#checkReadyToCalibrate();
	};

	#videoClick = async event => {
		const { video, device_selector, rom_selector, palette_selector } =
			this.#domrefs;

		event.preventDefault();

		device_selector.disabled = true;
		rom_selector.disabled = true;
		palette_selector.disabled = true;

		const video_styles = getComputedStyle(video);
		const ratioX = event.offsetX / css_size(video_styles.width);
		const ratioY = event.offsetY / css_size(video_styles.height);

		const floodStartPoint = [
			Math.round(video.videoWidth * ratioX),
			Math.round(video.videoHeight * ratioY),
		];

		const video_capture = document.createElement('canvas');
		const video_capture_ctx = video_capture.getContext('2d', { alpha: false });

		const bitmap = await createImageBitmap(
			video,
			0,
			0,
			video.videoWidth,
			video.videoHeight
		);

		updateCanvasSizeIfNeeded(
			video_capture,
			video.videoWidth,
			video.videoHeight
		);

		await sleep(0); // wait one tick for canvas to be updated ... just in case

		if (video.ntcType === 'device') {
			video_capture_ctx.filter = 'brightness(1.65) contrast(1.65)';
		} else {
			video_capture_ctx.filter = 'contrast(1.5)';
		}

		video_capture_ctx.drawImage(bitmap, 0, 0);

		await sleep(0); // wait one tick for everything to be drawn nicely... just in case

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

		const reference_crop = REFERENCE_LOCATIONS.field_w_borders.crop;

		let [ox, oy, ow, oh] = getCaptureCoordinates(
			[REFERENCE_SIZE.w, REFERENCE_SIZE.h],
			[reference_crop.x, reference_crop.y, reference_crop.w, reference_crop.h],
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

		console.log('Using offsets: ', ox, oy, ow, oh);

		this.#finalizeConfig({
			tetris_ui_in_video_xywh: [ox, oy, ow, oh],
		});
	};

	#checkReadyToCalibrate = () => {
		const { device_selector, rom_selector, instructions } = this.#domrefs;

		const all_ready = device_selector.value && rom_selector.value;

		this.#pending_calibration = !!all_ready;

		instructions.classList[this.#pending_calibration ? 'remove' : 'add'](
			'is-hidden'
		);
	};

	async resetDevices() {
		const devicesList = await getConnectedDevices('videoinput');
		this.#updateDeviceList(devicesList);
	}

	#finalizeConfig(...args) {
		let config = null;

		try {
			config = this.#getConfig(...args);

			this.#saveAndDispatchConfig(config);
		} catch (err) {
			alert(
				`Unexpected Error: ${err.message}. Please try again or contact NTC devs.`
			);

			device_selector.disabled = false;
			rom_selector.disabled = false;
			palette_selector.disabled = false;
		}
	}

	#finalizeRetronConfig(retron_rom_id) {
		// 1 parse the rom id
		const m = retron_rom_id.match(
			/^retron_hdmi_(?<aspect>169|43)_(?<rom_id>classic|minimal)$/
		);

		if (!m) {
			throw new Error('Unexpected Retron rom ID');
		}

		const { aspect, rom_id } = m.groups;

		const config = this.#getRetronConfig(aspect, rom_id);

		this.#saveAndDispatchConfig(config);
	}

	#finalizeEverdriveConfig() {
		this.#saveAndDispatchConfig({
			device_id: 'everdrive',
		});
	}

	#saveAndDispatchConfig(config) {
		console.log({ config });

		saveConfig(config);

		// 1. Create a custom event to notify parent app
		const event = new CustomEvent('config-ready', {
			bubbles: true, // Allow event to bubble up
			composed: true, // Allow event to cross Shadow DOM boundary
			detail: {
				config,
			},
		});

		// 2. Dispatch the event from this custom element instance
		this.dispatchEvent(event);
	}

	#getConfig({ tetris_ui_in_video_xywh }) {
		const { device_selector, palette_selector, rom_selector } = this.#domrefs;
		const device_id = device_selector.value;

		if (!device_id) {
			throw new Error('No device selected');
		}

		const config = {
			device_id,
		};

		if (device_id === 'everdrive') {
			return config;
		}

		const rom_type = rom_selector.value;

		if (!rom_type) {
			throw new Error('No rom selected');
		}

		// below here we are in device or window capture
		const game_type = CONFIGS[rom_type].game_type;

		Object.assign(config, getDefaultOcrConfig(), {
			game_type,
			palette: palette_selector.value,
			brightness: device_id === 'window' ? 1 : 1.75,
			tasks: this.#getTasks(rom_type, tetris_ui_in_video_xywh),
		});

		return config;
	}

	#getRetronConfig(aspect, rom_id) {
		const { device_selector } = this.#domrefs;
		const device_id = device_selector.value;

		if (!device_id) {
			throw new Error('No device selected');
		}

		if (!/^(classic|minimal)$/.test(rom_id)) {
			throw new Error(`Invalid retron rom ID: ${rom_id}`);
		}

		const config = {
			...getDefaultOcrConfig(),
			device_id,
			game_type: BinaryFrame.GAME_TYPE[rom_id.toUpperCase()],
			palette: 'retron_hdmi',
		};

		for (const [name, definition] of Object.entries(
			RETRON_HD_CONFIG[aspect][rom_id]
		)) {
			config.tasks[name] = Object.assign(
				{},
				REFERENCE_LOCATIONS[name], // all task parameters
				definition // retron-specific crop values
			);
		}

		return config;
	}

	#getTasks(rom_type, tetris_ui_in_video_xywh) {
		const tasks = {};

		// compute all tasks crop details in relation to the video size
		const game_fields = CONFIGS[rom_type].fields;
		const [ox, oy, ow, oh] = tetris_ui_in_video_xywh;

		const xscale = ow / REFERENCE_SIZE.w;
		const yscale = oh / REFERENCE_SIZE.h;

		game_fields.forEach(name => {
			tasks[name] = JSON.parse(JSON.stringify(REFERENCE_LOCATIONS[name]));

			const crop = tasks[name].crop;

			console.log(name, 'crop before', crop);

			crop.x = Math.round(ox + crop.x * xscale);
			crop.y = Math.round(oy + crop.y * yscale);
			crop.w = Math.round(crop.w * xscale);
			crop.h = Math.round(crop.h * yscale);

			console.log(name, 'crop after', crop);
		});

		return tasks;
	}

	#updateDeviceList(devices) {
		console.log(Date.now(), 'updateDeviceList()');

		const { device_selector } = this.#domrefs;

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

				const config = appStore.getState().config;

				if (config && config.device_id === camera.deviceId) {
					camera_option.selected = true;
				}

				return camera_option;
			})
		);
	}

	connectedCallback() {
		this.resetDevices();
	}

	#stopVideo() {
		const { video } = this.#domrefs;

		if (video.srcObject) {
			video.pause();
			video.srcObject.getVideoTracks()[0].stop();
			video.srcObject = null;
		}
	}

	disconnectedCallback() {
		console.log('wizard.disconnectedCallback()');
		this.#stopVideo();
	}
}

customElements.define('ntc-wizard', NTC_Producer_Wizard);
