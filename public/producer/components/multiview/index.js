import { NtcComponent } from '../NtcComponent.js';
import { html } from '../../StringUtils.js';

import '../calibration.js';

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
	<div id="content" class="container is-fluid">
		<div id="settings" class="is-active">Hello<br />Where is this??</div>
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
`);

export class NTC_MultiView extends NtcComponent {
	#domrefs;
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
		};

		// top level listener to handle tabs
		this.#domrefs.tabs.addEventListener('click', this.#handleTabClick);
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

	addPlayer(player) {
		const { tabs, content } = this.#domrefs;

		const playerId = this.#players.length + 1;

		const tab = document.createElement('li');
		tab.dataset.target = `player-${playerId}`;

		const a = document.createElement('a');
		a.textContent = `Player ${playerId}`;
		tab.appendChild(a);

		const cal = document.createElement('ntc-calibration');
		cal.id = `player-${playerId}`;

		tabs.querySelector('ul').appendChild(tab);
		content.appendChild(cal);

		this.#players.push(player);
	}
}

customElements.define('ntc-multiview', NTC_MultiView);
