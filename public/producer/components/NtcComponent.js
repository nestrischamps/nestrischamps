function getBulmaSheets() {
	return Promise.all(
		['/vendor/bulma.1.0.4.min.css', '/vendor/bulma.ntc.css'].map(url =>
			fetch(url)
				.then(res => res.text())
				.then(css => {
					const sheet = new CSSStyleSheet();
					sheet.replaceSync(css);
					return sheet;
				})
		)
	);
}

let bulmaSheetsPromise;

export function lazyBulmaSheets() {
	if (!bulmaSheetsPromise) {
		bulmaSheetsPromise = getBulmaSheets(); // no await!
	}

	return bulmaSheetsPromise;
}

export class NtcComponent extends HTMLElement {
	constructor() {
		super();

		this.shadow = this.attachShadow({ mode: 'open' });

		this._bulmaSheets = lazyBulmaSheets();

		// NTC components will inherit bulma styles
		this._bulmaSheets.then(sheets => {
			this.shadow.adoptedStyleSheets = [...sheets];
		});
	}
}
