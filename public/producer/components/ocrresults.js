import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';

const MARKUP = html`
	<div id="ocr_results" class="columns container is-fluid">
		<fieldset class="column">
			<legend>Frame Data</legend>
			<dl id="frame_data"></dl>
		</fieldset>
		<fieldset class="column">
			<legend>OCR Performance (in ms)</legend>
			<dl id="perf_data"></dl>
		</fieldset>
	</div>
`;

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
	dl {
		display: grid;
		grid-template-columns: max-content auto;
		font-family: monospace;
		margin: 1em 0;
	}

	dt {
		grid-column-start: 1;
	}

	dd {
		grid-column-start: 2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
`);

export class NTC_Producer_OcrResults extends NtcComponent {
	#domrefs;

	constructor() {
		super();

		window.BULMA_STYLESHEETS.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;
		this.style.display = 'block';

		this.#domrefs = {
			frame_data: this.shadow.getElementById('frame_data'),
			perf_data: this.shadow.getElementById('perf_data'),
		};
	}

	set perfData(perf) {
		const { perf_data } = this.#domrefs;

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

	set frameData(data) {
		if (!data) return;

		const { frame_data } = this.#domrefs;

		for (const [name, value] of Object.entries(data)) {
			if (name === 'raw') continue;

			let dt = perf_data.querySelector(`dt.${name}`);
			let dd;

			if (dt) {
				dd = dt.nextSibling;
			} else {
				dt = document.createElement('dt');
				dd = document.createElement('dd');

				dt.classList.add(name);
				dt.textContent = name;

				frame_data.appendChild(dt);
				frame_data.appendChild(dd);
			}

			if (name === 'field') {
				const rows = Array(20)
					.fill()
					.map((_, idx) => value.slice(idx * 10, (idx + 1) * 10).join(''));
				dd.innerHTML = `${rows.join('<br/>')}`;
			} else {
				dd.textContent = value;
			}
		}
	}
}

customElements.define('ntc-ocrresults', NTC_Producer_OcrResults);
