import './components/wizard.js';
import './components/capture.js';
import './components/multiview/index.js';

import QueryString from '/js/QueryString.js';

import { sleep, timer } from './timer.js';
import { hasConfig, loadConfig } from './ConfigUtils.js';

import { CaptureDriver } from './CaptureDriver.js';
import { Player } from './Player.js';

async function initEverDriveCapture(config, tabToOpen) {
	removeCalibrationTab();
	initCaptureFromEverdrive(config.frame_rate); // TODO
}

async function initMultiViewerCapture(config) {
	const capture = document.createElement('ntc-multiview');

	document.body.prepend(capture);

	const driver = new CaptureDriver(config);

	let playerNum = (value => {
		return /^([1-9]|[123]\d)$/.test(value) ? parseInt(value, 10) : 1;
	})(QueryString.get('first_player'));

	for (const playerConfig of config.players) {
		const player = new Player(playerConfig, playerNum++);
		driver.addPlayer(player);
	}

	capture.setDriver(driver);
}

async function initOCRCapture(config, tabToOpen, stream) {
	console.log('initOCRCapture');

	console.log(config);

	const driver = new CaptureDriver(config, stream);
	const player = new Player(config);

	driver.addPlayer(player);

	const capture = document.createElement('ntc-capture');
	capture.id = 'capture';
	capture.setDriver(driver);
	capture.setPlayer(player);
	capture.showTab(tabToOpen);

	document.body.prepend(capture);
}

async function initFromConfig(tabToOpen, stream = null) {
	const config = await loadConfig();

	if (config.device_id === 'everdrive') {
		initEverDriveCapture(config, 'ocr_results');
	} else if (config.mode === 'multiviewer') {
		initMultiViewerCapture(config);
	} else {
		initOCRCapture(config, tabToOpen, stream);
	}
}

(async function main() {
	console.log('main');

	// unfortunate bootstrap delay, but makes everything else simpler later on
	await timer.init();

	if (hasConfig()) {
		console.log('has config');
		initFromConfig('ocr_results');
	} else {
		const wizard = document.createElement('ntc-wizard');
		document.body.prepend(wizard);

		const {
			detail: { stream },
		} = await new Promise(resolve => {
			wizard.addEventListener('config-ready', resolve, { once: true });
		});

		await sleep(0);
		wizard.remove();
		await sleep(0);

		initFromConfig('calibration', stream);
	}
})();
