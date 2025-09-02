import './cropcontrol.js';

import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';
import { REFERENCE_LOCATIONS, TASK_RESIZE } from '../constants.js';

const MARKUP = html`
	<div id="calibration" class="">
		<div id="instructions" class="mt-5 content notification is-warning">
			<h1 class="title is-6">Warning - Processing Load</h1>
			<p>
				When you are on the calibration tab, NTC does extra work to show you the
				parts being captured.<br />
				When you are done, move to another tab to save processing resources.
			</p>
		</div>

		<fieldset class="inputs">
			<legend>Controls</legend>

			<div
				class="field"
				style="display: none;"
				title="Use only half the height of the input video stream (1 line in 2), to help remove interlacing artefacts"
			>
				<label class="checkbox">
					Use half capture-height ⓘ
					<input type="checkbox" id="use_half_height" />
				</label>
			</div>

			<div class="field">
				<label class="checkbox">
					7 digits score
					<input type="checkbox" id="score7" />
				</label>
			</div>

			<div
				class="field"
				title="If you are not using a Retron, and if you are using an active splitter, you can disable this"
			>
				<label class="checkbox">
					Handle Retron levels X6 and X7 ⓘ
					<input
						type="checkbox"
						id="handle_retron_levels_6_7"
						checked
						autocomplete="off"
					/>
				</label>
			</div>

			<div class="field">
				<label>
					Capture Rate
					<span class="select is-small">
						<select id="capture_rate">
							<option value="24">24 fps</option>
							<option value="25">25 fps</option>
							<option value="30">30 fps</option>
							<option value="50">50 fps</option>
							<option value="60">60 fps</option>
						</select>
					</span>
				</label>
			</div>

			<div id="image_corrections">
				<div class="field brightness">
					Brightness:
					<input
						id="brightness"
						type="range"
						min="1"
						max="3"
						step="0.05"
						value="1"
					/>
					<span>1</span> <a href="#">Reset</a>
				</div>
				<div class="field contrast">
					Contrast:
					<input
						id="contrast"
						type="range"
						min="0"
						max="2"
						step="0.05"
						value="1"
					/>
					<span>1</span> <a href="#">Reset</a>
				</div>
			</div>
		</fieldset>

		<div id="extraction" class="columns">
			<div id="capture-container" class="column is-5">
				<div id="capture"></div>
			</div>
			<div id="adjustments" class="column is-7" data-crop-scope></div>
		</div>
	</div>
`;

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
	:host {
		display: block
	}

	#capture {
		margin-right: 1em;
		display: flex;
		flex-direction: column;
		row-gap: 1em;
		align-items: center;
		position: sticky;
		top: 0;
		padding-top: 1.5em;
	}

	#capture video {
		width: 360px;
	}

	canvas:first-of-type {
		width: 100%;
		max-width: 1920px;
	}
`);

const ATTRIBUTES = {
	enableShowParts: {
		name: 'enable-show-parts',
		init: 'true',
	},
	enableHalfHeight: {
		name: 'enable-use-half-height',
		init: 'true',
	},
	enableCaptureRate: {
		name: 'enable-capture-rate',
		init: 'true',
	},
};

export class NTC_Producer_Calibration extends NtcComponent {
	#domrefs;
	#observer;
	#hidePartsTID;

	static get observedAttributes() {
		return Object.values(ATTRIBUTES).map(v => v.name);
	}

	constructor() {
		super();

		this._bulmaSheets.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;

		this.#observer = new IntersectionObserver(this.#observerCallBack);

		this.#domrefs = {
			capture: this.shadow.getElementById('capture'),
			adjustments: this.shadow.getElementById('adjustments'),

			use_half_height: this.shadow.getElementById('use_half_height'),
			score7: this.shadow.getElementById('score7'),
			handle_retron_levels_6_7: this.shadow.getElementById(
				'handle_retron_levels_6_7'
			),
			capture_rate: this.shadow.getElementById('capture_rate'),

			brightness_slider: this.shadow.querySelector('.field.brightness input'),
			brightness_value: this.shadow.querySelector('.field.brightness span'),
			brightness_reset: this.shadow.querySelector('.field.brightness a'),

			contrast_slider: this.shadow.querySelector('.field.contrast input'),
			contrast_value: this.shadow.querySelector('.field.contrast span'),
			contrast_reset: this.shadow.querySelector('.field.contrast a'),
		};

		this.#domrefs.brightness_slider.addEventListener(
			'change',
			this.#onBrightnessChange
		);
		this.#domrefs.brightness_reset.addEventListener(
			'click',
			this.#onBrightnessReset
		);
		this.#domrefs.contrast_slider.addEventListener(
			'change',
			this.#onContrastChange
		);
		this.#domrefs.contrast_reset.addEventListener(
			'click',
			this.#onContrastReset
		);
		this.#domrefs.use_half_height.addEventListener(
			'change',
			this.#onUseHalfHeightChange
		);
		this.#domrefs.score7.addEventListener('change', this.#onScore7Change);
		this.#domrefs.handle_retron_levels_6_7.addEventListener(
			'change',
			this.#onHandleRetron67Change
		);
		this.#domrefs.capture_rate.addEventListener(
			'change',
			this.#onCaptureRateChange
		);

		this.addEventListener(
			'crop-coordinate-change',
			this.#handleCropCoordinateChange
		);
		this.addEventListener(
			'crop-coordinate-group-change',
			this.#handleCropCoordinateGroupChange
		);
	}

	#handleCropCoordinateChange = event => {
		event.stopPropagation();

		const {
			detail: { name, key, value },
		} = event;

		if (!this.ocr?.config?.tasks?.[name]) return;

		this.ocr.config.tasks[name].crop[key] = value;
		this.ocr.config.save([name]);
	};

	#handleCropCoordinateGroupChange = event => {
		event.stopPropagation();

		const {
			detail: { group, key, value },
		} = event;

		const names = [...group]
			.map(element => element.id)
			.filter(name => this.ocr?.config?.tasks?.[name]);

		names.forEach(name => {
			this.ocr.config.tasks[name].crop[key] = value;
		});

		this.ocr.config.save(names);
	};

	connectedCallback() {
		Object.values(ATTRIBUTES)
			.filter(({ name }) => !this.hasAttribute(name))
			.forEach(({ name, init }) => {
				this.attributeChangedCallback(name, '', init);
			});

		if ('MediaStreamTrackProcessor' in window) {
			// assume we use a frame reader rather than a interval timer
			// and therefore we must hide the capture rate selector
			// regardless of what the consumer said or the default value
			this.#domrefs.capture_rate.closest('.field').classList.add('is-hidden');
		}

		this.#observer.observe(this);
	}

	disconnectedCallback() {
		this.#observer.disconnect();
	}

	#observerCallBack = (entries, observer) => {
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				this.ocr.config.show_capture_ui = true;
			} else {
				this.ocr.config.show_capture_ui = false;
			}
		});
	};

	attributeChangedCallback(name, oldValue, newValue) {
		if (oldValue === newValue) {
			return;
		}

		const settingElement =
			this.#domrefs[name.replace(/^enable-/, '').replace(/-/g, '_')];

		if (!settingElement) return;

		settingElement
			.closest('.field')
			.classList[newValue === 'true' ? 'remove' : 'add']('is-hidden');
	}

	#onBrightnessChange = () => {
		const { brightness_slider, brightness_value } = this.#domrefs;

		const value = parseFloat(brightness_slider.value);
		brightness_value.textContent = value.toFixed(2);

		this.ocr.config.brightness = value;
		this.ocr.config.save();
	};

	#onBrightnessReset = evt => {
		evt.preventDefault();
		evt.stopPropagation();

		const { brightness_slider } = this.#domrefs;

		if (brightness_slider.value != '1') {
			brightness_slider.value = 1;
			this.#onBrightnessChange();
		}

		brightness_slider.focus();
	};

	#onContrastChange = () => {
		const { contrast_slider, contrast_value } = this.#domrefs;

		const value = parseFloat(contrast_slider.value);
		contrast_value.textContent = value.toFixed(2);

		this.ocr.config.contrast = value;
		this.ocr.config.save();
	};

	#onContrastReset = evt => {
		evt.preventDefault();
		evt.stopPropagation();

		const { contrast_slider } = this.#domrefs;

		if (contrast_slider.value != '1') {
			contrast_slider.value = 1;
			this.#onContrastChange();
		}

		contrast_slider.focus();
	};

	#onUseHalfHeightChange = () => {
		const { use_half_height, adjustments } = this.#domrefs;
		const config = this.ocr.config;

		config.use_half_height = !!use_half_height.checked;

		if (config.use_half_height) {
			// half the y and height of everything
			for (const [name, task] of Object.entries(config.tasks)) {
				if (!task?.crop) continue;

				task.crop.y = Math.floor(task.crop.y / 2);
				task.crop.h = Math.ceil(task.crop.h / 2);

				adjustments.querySelector(`#${name}`).setCoordinates(task.crop);

				this.ocr.capture_canvas.height = Math.ceil(
					this.ocr.video.videoHeight / 2
				);
			}
		} else {
			for (const [name, task] of Object.entries(config.tasks)) {
				if (!task?.crop) continue;

				task.crop.y = Math.floor(task.crop.y * 2);
				task.crop.h = Math.ceil(task.crop.h * 2);

				adjustments.querySelector(`#${name}`).setCoordinates(task.crop);

				this.ocr.capture_canvas.height = this.ocr.video.videoHeight;
			}
		}

		config.save();
	};

	#onScore7Change = () => {
		const config = this.ocr.config;
		config.score7 = !!this.#domrefs.score7.checked;
		const task = config.tasks.score;

		const scale6to7 =
			REFERENCE_LOCATIONS.score7.crop.w / REFERENCE_LOCATIONS.score.crop.w;

		// assume transition is valid
		if (config.score7) {
			task.crop.w *= scale6to7;
			task.pattern = REFERENCE_LOCATIONS.score7.pattern;
			task.canvas.width = TASK_RESIZE.score7.w;
		} else {
			task.crop.w /= scale6to7;
			task.pattern = REFERENCE_LOCATIONS.score.pattern;
			task.canvas.width = TASK_RESIZE.score.w;
		}

		task.crop.w = Math.round(task.crop.w);

		const scoreControls = this.shadow.getElementById('score');

		scoreControls.setCoordinates(task.crop);
		scoreControls.setCaptureCanvas(task.canvas);

		this.ocr.updateScore67Config();

		config.save();
	};

	#onHandleRetron67Change = () => {
		this.ocr.config.handle_retron_levels_6_7 =
			!!this.#domrefs.handle_retron_levels_6_7.checked;
		this.ocr.config.save();
	};

	#onCaptureRateChange = async () => {
		const { capture_rate } = this.#domrefs;

		const frame_rate = parseInt(capture_rate.value, 10);

		this.ocr.config.frame_rate = frame_rate;
		this.ocr.config.save();

		const video = this.ocr.video;
		const stream = video.srcObject;
		const videoTrack = stream.getVideoTracks()[0];

		const newConstraints = {
			frameRate: { ideal: frame_rate },
		};

		try {
			// Apply the new constraints
			await videoTrack.applyConstraints(newConstraints);

			// Check the settings again to confirm only the frame rate changed
			const updatedSettings = videoTrack.getSettings();
			console.log('New frame rate:', updatedSettings.frameRate);
		} catch (error) {
			console.error('Failed to update constraints:', error);
		}
	};

	setDriver(driver) {
		this.driver = driver;
	}

	setOCR(ocr) {
		if (this.ocr) {
			this.ocr.removeEventListener('frame', this.#handleFrame);
		}

		this.ocr = ocr;

		const {
			capture,
			adjustments,
			score7,
			use_half_height,
			handle_retron_levels_6_7,
			capture_rate,
			contrast_slider,
			brightness_slider,
		} = this.#domrefs;

		capture.replaceChildren(ocr.capture_canvas, ocr.output_canvas);

		adjustments.replaceChildren(
			...Object.keys(TASK_RESIZE) // ensures consistent order
				.map(name => {
					const task = ocr.config.tasks[name];

					if (!task) return null;

					const control = document.createElement('ntc-cropcontrol');

					control.id = name;

					if (/^color/.test(name)) {
						control.setAttribute('bind', 'colors-xw');
					} else if (name.length === 1) {
						control.setAttribute('bind', 'stats-xw');
					}

					control.setCoordinates(task.crop);
					control.setCaptureCanvas(task.canvas);

					return control;
				})
				.filter(v => v)
		);

		capture_rate.value = this.ocr.config.frame_rate || 60;
		contrast_slider.value = this.ocr.config.contrast;
		brightness_slider.value = this.ocr.config.brightness;

		score7.checked = !!this.ocr.config.score7;
		use_half_height.checked = !!this.ocr.config.use_half_height;
		handle_retron_levels_6_7.checked =
			!!this.ocr.config.handle_retron_levels_6_7;

		this.#onBrightnessChange();
		this.#onContrastChange();

		this.ocr.addEventListener('frame', this.#handleFrame);
	}

	#handleFrame = event => {
		if (!this.ocr.config.show_capture_ui) return;

		const { detail: frame } = event;

		Object.entries(frame).forEach(([name, value]) => {
			const control = this.shadow.getElementById(name);
			control?.setOCRResults?.(value);
		});
	};
}

customElements.define('ntc-calibration', NTC_Producer_Calibration);
