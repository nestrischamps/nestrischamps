import { NtcComponent } from '../NtcComponent.js';
import { html } from '../../StringUtils.js';
import { clearConfigAndReset } from '../../ConfigUtils.js';

import '../calibration.js';
import '../PerfResults.js';
import '../CaptureDetails.js';

const MARKUP = html`
	<div id="nav_container" class="container is-fluid pt-5 pb-3">
		<div
			id="tabs"
			class="tabs is-toggle is-toggle-rounded is-fullwidth is-medium m-0"
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
			<div>
				<fieldset>
					<legend>Controls</legend>

					<div class="field">
						<button id="clear_config" class="button is-light">
							Clear Config and Restart
						</button>
					</div>
				</fieldset>
			</div>
			<div class="columns is-align-items-flex-start">
				<fieldset id="source" class="column">
					<legend>Source</legend>
					<div id="video_container"></div>
				</fieldset>

				<div class="column p-0">
					<fieldset>
						<legend>Capture Info</legend>
						<ntc-capturedetails id="capture_details"></ntc-capturedetails>
					</fieldset>
					<fieldset>
						<legend>OCR Performance (in ms)</legend>
						<ntc-perfresults id="perf_data"></ntc-perfresults>
					</fieldset>
				</div>
			</div>
		</div>
	</div>
`;

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
	:host {
		display: block;
	}

	#nav_container {
		position: sticky;
		top: 0;
		z-index: 10;
		background-color: var(--scheme-main, #181c20);
	}

    #content > * {
        display: none;
    }

    #content > *.is-active {
        display: block;
    }

	#video_container {
		text-align: center;
	}

	video {
		width: 100%;
		max-width: 1920px;
	}
`);

export class NTC_MultiView extends NtcComponent {
	#domrefs;
	#driver;
	#players;

	constructor() {
		super();

		this._bulmaSheets.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;

		this.#players = [];

		this.#domrefs = {
			tabs: this.shadow.getElementById('tabs'),
			content: this.shadow.getElementById('content'),
			source: this.shadow.getElementById('source'),
			video_container: this.shadow.getElementById('video_container'),
			clear_config: this.shadow.getElementById('clear_config'),
			capture_details: this.shadow.getElementById('capture_details'),
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
		const { video_container } = this.#domrefs;
		this.#driver = driver;

		for (const player of this.#driver.players) {
			this.addPlayer(player);
		}

		video_container.appendChild(this.#driver.getVideo());

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

		const calibration = document.createElement('ntc-calibration');
		calibration.id = `player-${playerId}`;
		calibration.setAttribute('enable-show-parts', 'false');
		calibration.setAttribute('enable-capture-rate', 'false');

		calibration.setPlayer(player);

		player.ocrPromise.then(ocr => {
			calibration.setOCR(ocr);
		});

		player.addEventListener('remote_config_update', ({ detail: config }) => {
			calibration.handleRemoteConfigUpdate(config);
		});

		tabs.querySelector('ul').appendChild(tab);
		content.appendChild(calibration);

		this.#players.push(player);
	}

	#handleFrame = event => {
		this.#domrefs.perf_data.showPerfData(event);
		this.#domrefs.capture_details.showCaptureDetails(event);
	};
}

customElements.define('ntc-multiview', NTC_MultiView);
