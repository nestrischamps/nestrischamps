import { NtcComponent } from '../NtcComponent.js';
import { html } from '../../StringUtils.js';
import { clearConfigAndReset } from '../../ConfigUtils.js';

import '../calibration.js';
import '../PerfResults.js';

const MARKUP = html`
	<div class="container is-fluid mt-5">
		<div
			id="tabs"
			class="tabs is-toggle is-toggle-rounded is-fullwidth is-medium"
		>
			<ul>
				<li data-target="settings" class="is-active">
					<a>Settings</a>
				</li>
			</ul>
		</div>
	</div>
	<div id="content" class="container mt-5 is-fluid">
		<div id="settings" class="is-active">
			<div class="colums">
				<fieldset>
					<legend>Controls</legend>

					<div class="field">
						<button id="clear_config" class="button is-light">
							Clear config and Restart
						</button>
					</div>
				</fieldset>
			</div>
			<div class="columns">
				<fieldset id="source" class="column">
					<legend>Source</legend>
				</fieldset>

				<fieldset class="column">
					<legend>OCR Performance (in ms)</legend>
					<ntc-perfresults id="perf_data"></ntc-perfresults>
				</fieldset>
			</div>
		</div>
	</div>
`;

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
	:host {
		display: block
	}

    #content > * {
        display: none;
    }

    #content > *.is-active {
        display: block;
    }

	#source {
		text-align: center;
	}

	video {
		width: 500px;
	}
`);

export class NTC_MultiView extends NtcComponent {
	#domrefs;
	#driver;
	#players;

	constructor() {
		super();

		window.BULMA_STYLESHEETS.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;

		this.#players = [];

		this.#domrefs = {
			tabs: this.shadow.getElementById('tabs'),
			content: this.shadow.getElementById('content'),
			source: this.shadow.getElementById('source'),
			clear_config: this.shadow.getElementById('clear_config'),
			perf_data: this.shadow.getElementById('perf_data'),
		};

		// top level listener to handle tabs
		this.#domrefs.tabs.addEventListener('click', this.#handleTabClick);
		this.#domrefs.clear_config.addEventListener('click', clearConfigAndReset);
	}

	#handleTabClick = event => {
		const { tabs, content } = this.#domrefs;

		const tab = event.target.closest('li');

		if (!tab) return;

		tabs.querySelector('.is-active').classList.remove('is-active');
		content.querySelector('.is-active').classList.remove('is-active');

		const pane = content.querySelector(`#${tab.dataset.target}`);

		tab.classList.add('is-active');
		pane.classList.add('is-active');
	};

	setDriver(driver) {
		const { source } = this.#domrefs;
		this.#driver = driver;

		for (const player of this.#driver.players) {
			this.addPlayer(player);
		}

		source.appendChild(this.#driver.getVideo());

		this.#driver.addEventListener('frame', this.#handleFrame);
	}

	addPlayer(player) {
		const { tabs, content } = this.#domrefs;

		const playerId = this.#players.length + 1;

		const tab = document.createElement('li');
		tab.dataset.target = `player-${playerId}`;

		const a = document.createElement('a');
		a.textContent = `Player ${player.num}`;
		tab.appendChild(a);

		const cal = document.createElement('ntc-calibration');
		cal.id = `player-${playerId}`;
		cal.setAttribute('enable-show-parts', 'false');
		cal.setAttribute('enable-use-half-height', 'false');
		cal.setAttribute('enable-capture-rate', 'false');
		cal.setOCR(player.ocr);

		tabs.querySelector('ul').appendChild(tab);
		content.appendChild(cal);

		this.#players.push(player);
	}

	#handleFrame = () => {
		this.#domrefs.perf_data.showPerfData();
	};
}

customElements.define('ntc-multiview', NTC_MultiView);
