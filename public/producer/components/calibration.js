import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';

const MARKUP = html` <h1 class="title">Calibration</h1> `;

export class NTC_Producer_Calibration extends NtcComponent {
	#domrefs;

	constructor() {
		super();

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {};
	}
}

customElements.define('ntc-calibration', NTC_Producer_Calibration);
