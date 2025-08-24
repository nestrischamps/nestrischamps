import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';
import './PerfResults.js';

const MARKUP = html`
	<div id="ocr_results" class="columns container is-fluid">
		<fieldset class="column">
			<legend>Frame Data</legend>
			<dl id="frame_data"></dl>
		</fieldset>
		<fieldset class="column">
			<legend>OCR Performance (in ms)</legend>
			<ntc-perfresults id="perf_data"></ntc-perfresults>
		</fieldset>
	</div>
`;

export class NTC_Producer_OcrResults extends NtcComponent {
	#domrefs;

	constructor() {
		super();

		this.shadow.innerHTML = MARKUP;
		this.style.display = 'block';

		this.#domrefs = {
			frame_data: this.shadow.getElementById('frame_data'),
			perf_data: this.shadow.getElementById('perf_data'),
		};
	}

	setOCR(ocr) {
		this.ocr = ocr;

		ocr.addEventListener('frame', this.#handleOCRFrame);
	}

	setGameTracker(game_tracker) {
		this.game_tracker = game_tracker;

		game_tracker.addEventListener('frame', this.#handleGameTrackerFrame);
	}

	#handleOCRFrame = () => {
		this.#domrefs.perf_data.showPerfData();
	};

	#handleGameTrackerFrame = ({ detail: frame }) => {
		this.#setFrameData(frame);
	};

	#setFrameData(data) {
		if (!data) return;

		const { frame_data } = this.#domrefs;

		for (const [name, value] of Object.entries(data)) {
			if (name === 'raw') continue;

			let dt = frame_data.querySelector(`dt._${name}`);
			let dd;

			if (dt) {
				dd = dt.nextSibling;
			} else {
				dt = document.createElement('dt');
				dd = document.createElement('dd');

				dt.classList.add(`_${name}`);
				dt.textContent = name;

				frame_data.appendChild(dt);
				frame_data.appendChild(dd);
			}

			if (name === 'field') {
				if (
					Array.isArray(value) ||
					value instanceof Uint8Array ||
					value instanceof Uint32Array
				) {
					const rows = Array(20)
						.fill()
						.map((_, idx) => value.slice(idx * 10, (idx + 1) * 10).join(''));
					dd.innerHTML = `${rows.join('<br/>')}`;
				} else {
					const rows = Array(20)
						.fill()
						.map((_, idx) =>
							value.colors
								.slice(idx * 10, (idx + 1) * 10)
								.map(v => (v ? 1 : 0))
								.join('')
						);
					dd.innerHTML = `${rows.join('<br/>')}`;
				}
			} else {
				dd.textContent = value;
			}
		}
	}
}

customElements.define('ntc-ocrresults', NTC_Producer_OcrResults);
