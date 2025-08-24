import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';

const MARKUP = html`<dl id="perf_data"></dl>`;

function sortByDriverAndPlayerReverse(k1, k2) {
	const isDriver1 = k1.includes('driver');
	const isDriver2 = k2.includes('driver');

	if (isDriver1 && !isDriver2) return 1;
	if (!isDriver1 && isDriver2) return -1;

	// Both driver or both player
	// no need to test for equality, since there cannot be duplicates
	return k1 < k2 ? 1 : -1;
}

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
    :host {
        display: block
    }
`);

export class NTC_PerfResults extends NtcComponent {
	#domrefs;
	#last_perf = {};
	#dompairs = new Map();

	constructor() {
		super();

		this.shadow.innerHTML = MARKUP;

		window.BULMA_STYLESHEETS.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.#domrefs = {
			perf_data: this.shadow.getElementById('perf_data'),
		};

		setInterval(this.#reorder, 10000);
	}

	#doShowPerfData() {
		const { perf_data } = this.#domrefs;

		for (const [name, value] of Object.entries(this.#last_perf)) {
			const pair = this.#dompairs.get(name);

			if (pair) {
				const { dt, dd } = pair;
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

				this.#dompairs.set(name, { dt, dd });
			}
		}
	}

	#reorder = () => {
		const { perf_data } = this.#domrefs;

		// TODO: force clean order of more of the known metrics 😢 (e.g. driver total, player total, etc.)
		// For now, we push the driver metrics on top, since that's the most important total
		[...this.#dompairs.keys()]
			.filter(key => /(driver|player-\d+)-\d+/.test(key))
			.sort(sortByDriverAndPlayerReverse) // reverse because we insert by prepend
			.forEach(key => {
				const { dt, dd } = this.#dompairs.get(key);

				perf_data.prepend(dd);
				perf_data.prepend(dt);
			});
	};

	showPerfData() {
		// 1. compute all available perf measurements
		const perf = {};

		performance.getEntriesByType('measure').forEach(m => {
			// discard browser performance measurements -_-
			if (m.name.startsWith('browser::')) return;
			if (m.name.startsWith('invoke-')) return;
			if (m.name.startsWith('inline-')) return;
			if (m.name.startsWith('DOM-')) return;
			if (m.name.startsWith('ANALYZE_')) return;

			perf[m.name] = m.duration.toFixed(3);
		});

		// s. store data
		this.#last_perf = perf;

		// 3. update display
		this.#doShowPerfData();
	}
}

customElements.define('ntc-perfresults', NTC_PerfResults);
