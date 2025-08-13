import './cropcontrol.js';

import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';

const MARKUP = html`
	<div id="calibration" class="">
		<fieldset class="inputs">
			<legend>Controls</legend>

			<div class="field">
				<label class="checkbox">
					Show Parts
					<input type="checkbox" id="show_parts" checked autocomplete="off" />
				</label>
			</div>

			<div
				class="field"
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

			<div
				class="field"
				title="Use Web Worker to provide stable interval even when the tab is unfocused"
			>
				<label class="checkbox">
					Use Web Worker for interval ⓘ
					<input
						type="checkbox"
						id="web_worker_timer"
						checked
						autocomplete="off"
					/>
				</label>
			</div>

			<div class="field">
				<label for="show_parts">
					Capture Rate
					<span class="select is-small">
						<select id="capture_rate">
							<option value="25">24 fps</option>
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
				<div id="capture">
					<video id="device_video" playsinline controls="false"></video>
				</div>
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
		width: 500px;
	}
`);

const ATTRIBUTES = {
	enableShowParts: {
		name: 'enable-show-parts',
		init: 'true',
	},
	enableWebWorkerTimer: {
		name: 'enable-web-worker-timer',
		init: 'false',
	},
	enableCaptureRate: {
		name: 'enable-capture-rate',
		init: 'true',
	},
};

export class NTC_Producer_Calibration extends NtcComponent {
	#domrefs;

	static get observedAttributes() {
		return Object.values(ATTRIBUTES).map(v => v.name);
	}

	constructor() {
		super();

		window.BULMA_STYLESHEETS.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {
			capture: this.shadow.getElementById('capture'),
			adjustments: this.shadow.getElementById('adjustments'),

			show_parts: this.shadow.getElementById('show_parts'),
			use_half_height: this.shadow.getElementById('use_half_height'),
			score7: this.shadow.getElementById('score7'),
			handle_retron_levels_6_7: this.shadow.getElementById(
				'handle_retron_levels_6_7'
			),
			web_worker_timer: this.shadow.getElementById('web_worker_timer'),
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
		this.#domrefs.show_parts.addEventListener(
			'change',
			this.#onShowPartsChange
		);
		this.#domrefs.web_worker_timer.addEventListener(
			'change',
			this.#onWebWorkerTimerChange
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

		console.log({ name, key, value });

		if (!this.ocr?.config?.tasks?.[name]) return;

		this.ocr.config.tasks[name].crop[key] = value;
		this.ocr.config.save();
	};

	#handleCropCoordinateGroupChange = event => {
		event.stopPropagation();

		const {
			detail: { group, key, value },
		} = event;

		[...group]
			.map(element => element.id)
			.forEach(name => {
				if (!this.ocr?.config?.tasks?.[name]) return;

				this.ocr.config.tasks[name].crop[key] = value;
			});

		this.ocr.config.save();
	};

	connectedCallback() {
		Object.values(ATTRIBUTES)
			.filter(({ name }) => !this.hasAttribute(name))
			.forEach(({ name, init }) => {
				this.attributeChangedCallback(name, '', init);
			});
	}

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
	};

	#onShowPartsChange() {}
	#onWebWorkerTimerChange() {}
	#onCaptureRateChange() {}

	setOCR(ocr) {
		if (this.ocr) {
			this.ocr.removeEventListener('frame', this.#handleFrame);
		}

		this.ocr = ocr;

		const { capture, adjustments, contrast_slider, brightness_slider } =
			this.#domrefs;

		capture.replaceChildren(
			ocr.video,
			ocr.capture_canvas,
			// ocr.output_canvas,
			ocr.digit_canvas_1
		);

		adjustments.replaceChildren(
			...Object.entries(ocr.all_tasks).map(([name, task]) => {
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
		);

		contrast_slider.value = this.ocr.config.contrast;
		brightness_slider.value = this.ocr.config.brightness;

		this.#onBrightnessChange();
		this.#onContrastChange();

		this.ocr.addEventListener('frame', this.#handleFrame);
	}

	#handleFrame = event => {
		const {
			detail: { frame, perf },
		} = event;

		Object.entries(frame).forEach(([name, value]) => {
			const control = this.shadow.getElementById(name);
			control?.setOCRResults?.(value);
		});
	};
}

customElements.define('ntc-calibration', NTC_Producer_Calibration);
