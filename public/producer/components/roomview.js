import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';

const MARKUP = html` <h1 class="title">Room View</h1> `;

export class NTC_Producer_RoomView extends NtcComponent {
	#domrefs;

	constructor() {
		super();

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {};
	}
}

customElements.define('ntc-roomview', NTC_Producer_RoomView);
