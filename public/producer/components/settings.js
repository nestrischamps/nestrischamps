import QueryString from '/js/QueryString.js';
import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';
import { clearConfigAndReset } from '../ConfigUtils.js';

import './camera.js';

const MARKUP = html`
	<div id="inputs" class="columns container is-fluid">
		<div class="column">
			<fieldset id="controls">
				<legend>Controls</legend>

				<div class="field">
					<button id="clear_config" class="button is-light">
						Clear Config and Restart
					</button>
				</div>

				<div class="field">
					<button id="save_game_palette" class="button is-light" disabled>
						Save Last Game's Palette
					</button>
				</div>

				<div id="timer_control" class="field is-hidden">
					<button id="start_timer" class="button">Start Timer</button>
					for
					<input type="number" id="minutes" value="120" min="5" max="5949" />
					minutes
				</div>
			</fieldset>
		</div>

		<ntc-camera id="camera" class="column"></ntc-camera>
	</div>
`;

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
	.column {
		padding: 0;
	}
		
	#vdoninja_iframe {
		width: 100%;
		height: 30em;
	}
`);

export class NTC_Producer_Settings extends NtcComponent {
	#domrefs;
	#player;

	constructor() {
		super();

		this._bulmaSheets.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;
		this.style.display = 'block';

		this.#domrefs = {
			clear_config: this.shadow.getElementById('clear_config'),
			save_game_palette: this.shadow.getElementById('save_game_palette'),
			timer_control: this.shadow.getElementById('timer_control'),
			start_timer: this.shadow.getElementById('start_timer'),
			camera: this.shadow.getElementById('camera'),
		};

		this.#domrefs.clear_config.addEventListener('click', clearConfigAndReset);

		if (QueryString.get('timer') === '1') {
			this.#domrefs.timer_control.classList.remove('is_hidden');
		}
	}

	async setPlayer(player) {
		this.#player = player;
		this.#domrefs.camera.setPlayer(player);
	}
}

customElements.define('ntc-settings', NTC_Producer_Settings);
