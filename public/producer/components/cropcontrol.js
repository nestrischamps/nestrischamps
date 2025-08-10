import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';

const MARKUP = html`
	<fieldset>
		<legend>Crop Controls</legend>
		<div id="controls" class="field is-horizontal">
			<div class="field-label is-normal">
				<label class="label">x:</label>
			</div>
			<input id="x" class="input is_small" type="number" size="3" min="0" />
			<div class="field-label is-normal">
				<label class="label">y:</label>
			</div>
			<input id="y" class="input is_small" type="number" size="3" min="0" />
			<div class="field-label is-normal">
				<label class="label">width:</label>
			</div>
			<input id="w" class="input is_small" type="number" size="3" min="1" />
			<div class="field-label is-normal">
				<label class="label">height:</label>
			</div>
			<input id="h" class="input is_small" type="number" size="3" min="1" />
		</div>
		<div id="results" class="is-flex is-align-items-center is-gap-1 mt-2">
			<div id="capture"></div>
			<div>=&gt;</div>
			<div id="ocr"></div>
		</div>
	</fieldset>
`;

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
    :host {
        display: block;
    }

    .field-label {
        margin-inline-end: 0.8rem !important;
    }

    input:not(:last-child) {
        margin-inline-end: 1rem !important;
    }

    canvas {
        image-rendering: pixelated;
        image-rendering: -webkit-optimize-contrast;
        image-rendering: -moz-crisp-edges;
    }
`);

export class NTC_Crop_Control extends NtcComponent {
	#domrefs;
	#groupSettings;

	canvasScaleFactor = 3;

	static get observedAttributes() {
		return ['name'];
	}

	constructor() {
		super();

		window.BULMA_STYLESHEETS.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {
			legend: this.shadow.querySelector('legend'),
			capture: this.shadow.getElementById('capture'),
			ocr: this.shadow.getElementById('ocr'),
			x: this.shadow.getElementById('x'),
			y: this.shadow.getElementById('y'),
			w: this.shadow.getElementById('w'),
			h: this.shadow.getElementById('h'),
		};

		if (this.getAttribute('name')) {
			this.#domrefs.legend.textContent = this.getAttribute('name');
		} else if (this.id) {
			this.#domrefs.legend.textContent = this.id;
		}

		this.shadow.querySelectorAll('input[type=number]').forEach(input => {
			input.addEventListener('change', this.#handleCoordinateChange);
		});
	}

	#getScopeElement() {
		return this.closest('[data-crop-scope]') || document.body; // Default to body
	}

	#getGroupSettings() {
		const groupName = this.getAttribute('bind');

		if (!/^[a-z]+-[xywh]{1,4}$/.test(groupName)) return null;

		const scopeElement = this.#getScopeElement();

		if (!scopeElement._ntc_crop_control_groupManager) {
			scopeElement._ntc_crop_control_groupManager = new Map();
		}

		const groupManager = scopeElement._ntc_crop_control_groupManager;

		if (!groupManager.has(groupName)) {
			groupManager.set(groupName, new Set());
		}

		const group = groupManager.get(groupName);

		const boundInputIds = new Set(groupName.split('-')[1].split(''));
		const boundInputs = [...boundInputIds].map(id => this.#domrefs[id]);

		return {
			groupName,
			groupManager,
			group,
			boundInputs,
		};
	}

	connectedCallback() {
		this.#groupSettings = this.#getGroupSettings();

		if (!this.#groupSettings) return;

		const { group, boundInputs } = this.#groupSettings;

		group.add(this);

		boundInputs.forEach(input => {
			input.addEventListener('change', this.#handleGroupPropagation);
		});
	}

	disconnectedCallback() {
		if (!this.#groupSettings) return;

		const { group, boundInputs } = this.#groupSettings;

		group.delete(this);

		boundInputs.forEach(input => {
			input.removeEventListener('change', this.#handleGroupPropagation);
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

	getCropCoordinates() {
		const { x, y, w, h } = this.#domrefs;

		return {
			x: parseInt(x.value, 10) || 0,
			y: parseInt(y.value, 10) || 0,
			w: parseInt(w.value, 10) || 0,
			h: parseInt(h.value, 10) || 0,
		};
	}

	setCoordinates(coordinates) {
		Object.entries(coordinates).forEach(([key, value]) => {
			if (!/^[xywh]$/.test(key)) return; // should throw?

			this.#domrefs[key].value = value;
		});
	}

	setCaptureCanvas(canvas) {
		// TODO: replace by an additional adopted stylesheet to hide from inline dom inspection...
		Object.assign(canvas.style, {
			width: `${canvas.width * this.canvasScaleFactor}px`,
			height: `${canvas.height * this.canvasScaleFactor}px`,
		});

		this.#domrefs.capture.replaceChildren(canvas);
	}

	setOCRResult(results) {
		// dirty but include formatting logic based on OCR type type...
		this.#domrefs.ocr.replaceChildren(results);
	}

	#handleCoordinateChange = sourceEvent => {
		const composedEvent = new CustomEvent('crop-coordinate-change', {
			bubbles: true,
			composed: true, // Allows the event to cross Shadow DOM boundaries
			detail: {
				name: this.getAttribute('name') || this.id, // field name (e.g. score, lines)

				og_target: sourceEvent.target,

				key: sourceEvent.target.id, // x, y, w, h
				value: parseInt(sourceEvent.target.value, 10),

				coordinates: this.getCropCoordinates(), // just give everything, easier that ways
			},
		});

		sourceEvent.target.dispatchEvent(composedEvent);
	};

	#handleGroupPropagation = sourceEvent => {
		const { groupName, group } = this.#groupSettings;
		const update = {
			[sourceEvent.target.id]: parseInt(sourceEvent.target.value, 10),
		};

		group.forEach(element => {
			if (element !== this) {
				element.setCoordinates(update); // To decide: should this fire individual change events?
			}
		});

		const composedEvent = new CustomEvent('crop-coordinate-group-change', {
			bubbles: true,
			composed: true, // Allows the event to cross Shadow DOM boundaries
			detail: {
				name: this.getAttribute('name') || this.id, // field name (e.g. score, lines)

				groupName,
				group,

				og_target: sourceEvent.target,

				key: sourceEvent.target.id, // x, y, w, h
				value: parseInt(sourceEvent.target.value, 10),
			},
		});

		sourceEvent.target.dispatchEvent(composedEvent);
	};
}

customElements.define('ntc-cropcontrol', NTC_Crop_Control);
