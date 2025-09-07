import { NtcComponent } from './NtcComponent.js';

import './settings.js';
import './calibration.js';
import './ocrresults.js';
import './roomview.js';

import { html } from '../StringUtils.js';

const MARKUP = html`
	<div id="capture" class="container is-fluid mt-5">
		<div
			id="tabs"
			class="tabs is-toggle is-toggle-rounded is-fullwidth is-medium"
		>
			<ul>
				<li data-target="settings" class="is-active">
					<a>
						<span>Settings</span>
					</a>
				</li>
				<li data-target="ocr_results">
					<a>
						<span>Data</span>
					</a>
				</li>
				<li data-target="calibration">
					<a>
						<span>Calibration</span>
					</a>
				</li>
				<li data-target="room">
					<a>
						<span>Room View</span>
					</a>
				</li>
			</ul>
		</div>
	</div>
	<div id="content" class="container is-fluid">
		<ntc-settings id="settings" class="tab-item is-hidden"></ntc-settings>
		<ntc-ocrresults
			id="ocr_results"
			class="tab-item is-hidden"
		></ntc-ocrresults>
		<ntc-calibration
			id="calibration"
			class="tab-item is-hidden"
		></ntc-calibration>
		<ntc-roomview id="room" class="tab-item is-hidden"></ntc-roomview>
	</div>
`;

export class NTC_Producer_Capture extends NtcComponent {
	#domrefs;
	#player;
	#is_match_room;

	constructor() {
		super();

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {
			tabs: this.shadow.querySelectorAll('#tabs li'),
			content: this.shadow.getElementById('content'),
			tabContents: this.shadow.querySelectorAll('#content .tab-item'),
			settings: this.shadow.getElementById('settings'),
			ocr_results: this.shadow.getElementById('ocr_results'),
			calibration: this.shadow.getElementById('calibration'),
			room: this.shadow.getElementById('room'),
		};

		this.#is_match_room = /^\/room\/u\//.test(new URL(location).pathname);

		this.#initTabControls();
	}

	#initTabControls() {
		const { tabs, tabContents, room } = this.#domrefs;

		if (!this.#is_match_room) {
			[...tabs].find(tab => tab.dataset.target === 'room').remove();
			room.remove();
		}

		tabContents.forEach(box => box.classList.add('is-hidden'));

		tabs.forEach(tab => {
			tab.addEventListener('click', () => {
				this.showTab(tab.dataset.target);
			});
		});
	}

	showTab(id) {
		const { tabs, tabContents } = this.#domrefs;
		const tab = [...tabs].find(tab => tab.dataset.target === id);

		tabs.forEach(tab => tab.classList.remove('is-active'));
		tab.classList.add('is-active');

		tabContents.forEach(box => {
			box.classList[box.id === id ? 'remove' : 'add']('is-hidden');
		});
	}

	async setDriver(driver) {
		this.#domrefs.ocr_results.setDriver(driver);
	}

	async setPlayer(player) {
		this.#player = player;

		this.#domrefs.settings.setPlayer(player);

		player.addEventListener('make_player', ({ detail }) => {
			this.#domrefs.room.loadRoomView(detail.view_meta);
		});

		player.addEventListener('remote_config_update', ({ detail: config }) => {
			this.#domrefs.calibration.handleRemoteConfigUpdate(config);
		});

		const ocr = await this.#player.ocrPromise;
		this.#domrefs.ocr_results.setOCR(ocr);
		this.#domrefs.calibration.setOCR(ocr);

		const gameTracker = this.#player.gameTracker;
		this.#domrefs.ocr_results.setGameTracker(gameTracker);

		this.#domrefs.room.setReadyHandler(this.#player.sendReady);
	}
}

customElements.define('ntc-capture', NTC_Producer_Capture);
