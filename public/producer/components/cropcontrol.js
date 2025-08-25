import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';
import { u32ToRgba } from '/ocr/utils.js';

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
		box-sizing: content-box !important;
    }

    .field-label {
        margin-inline-end: 0.8rem !important;
    }

    input:not(:last-child) {
        margin-inline-end: 1rem !important;
    }

    canvas {
        image-rendering: pixelated;
		border: 1px white solid;
    }

	#results {
		font-size: 2em;
	}

	pre {
		display: inline-block;
		padding: 0;
	}
`);

export class NTC_Crop_Control extends NtcComponent {
	#domrefs;
	#groupSettings;

	canvasScaleFactor = 3;

	constructor() {
		super();

		this._bulmaSheets.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {
			legend: this.shadow.querySelector('legend'),
			capture: this.shadow.getElementById('capture'),
			res: this.shadow.getElementById('results'),
			ocr: this.shadow.getElementById('ocr'),
			x: this.shadow.getElementById('x'),
			y: this.shadow.getElementById('y'),
			w: this.shadow.getElementById('w'),
			h: this.shadow.getElementById('h'),
		};

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
		this.#domrefs.legend.textContent = this.id;

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
		const scale = this.canvasScaleFactor * (/^color/.test(this.id) ? 2 : 1);

		// TODO: replace by an additional adopted stylesheet to hide from inline dom inspection...
		Object.assign(canvas.style, {
			width: `${canvas.width * scale}px`,
			height: `${canvas.height * scale}px`,
		});

		this.#domrefs.capture.replaceChildren(canvas);
	}

	setOCRResults(results) {
		const { ocr: holder, res } = this.#domrefs;

		if (holder.children.length <= 0) {
			if (this.id.startsWith('color')) {
				const color_result = document.createElement('div');
				color_result.classList.add('col_res');
				color_result.style.display = 'inline-block';
				color_result.style.border = '1px solid white';
				color_result.style.width = '30px';
				color_result.style.height = '30px';

				holder.before(color_result);
			} else if (this.id === 'field') {
				const field_result = document.createElement('canvas');
				field_result.width = 158;
				field_result.height = 318;
				field_result.classList.add('field_res');
				field_result.style.display = 'inline-block';

				const ctx = field_result.getContext('2d', { alpha: false });
				ctx.fillStyle = '#000000';
				ctx.fillRect(0, 0, 158, 318);

				holder.append(field_result);
			}

			const text_result = document.createElement('pre');

			holder.appendChild(text_result);
		}

		if (this.id.startsWith('color')) {
			const color = `rgb(${results[0]},${results[1]},${results[2]})`;
			res.querySelector(`.col_res`).style.backgroundColor = color;
			res.querySelector(`pre`).textContent = color;
		} else if (this.id === 'field') {
			const canvas = holder.querySelector(`.field_res`);
			const ctx = canvas.getContext('2d', { alpha: false });

			ctx.fillStyle = '#000000';
			ctx.fillRect(0, 0, 158, 318);

			for (let ridx = 0; ridx < 20; ridx++) {
				const row = results.subarray(ridx * 10, ridx * 10 + 10);

				row.forEach((col, cidx) => {
					const [r, g, b, shine] = u32ToRgba(col);
					if (shine <= 0) return;
					ctx.fillStyle = `rgb(${r},${g},${b})`;
					ctx.fillRect(cidx * 16, ridx * 16, 14, 14);
				});
			}
		} else {
			holder.querySelector(`pre`).innerHTML =
				results === null ? '&nbsp;' : results;
		}
	}

	#handleCoordinateChange = sourceEvent => {
		const composedEvent = new CustomEvent('crop-coordinate-change', {
			bubbles: true,
			composed: true, // Allows the event to cross Shadow DOM boundaries
			detail: {
				name: this.id, // field name (e.g. score, lines)

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
				name: this.id, // field name (e.g. score, lines)

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
