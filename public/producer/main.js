import './components/wizard.js';
import './components/capture.js';
import './components/multiview/index.js';

import QueryString from '/js/QueryString.js';

import loadPalettes from '/ocr/palettes.js';
import { sleep, timer } from './timer.js';
import { hasConfig, loadConfig } from './ConfigUtils.js';

import { CaptureDriver } from './CaptureDriver.js';
import { Player } from './Player.js';

function loadCaptureUI() {
	const capture = document.createElement('ntc-capture');

	capture.id = 'capture';
	document.body.prepend(capture);

	return capture;
}

async function initEverDriveCapture(config, tabToOpen) {
	removeCalibrationTab();
	initCaptureFromEverdrive(config.frame_rate); // TODO
}

async function initMultiViewerCapture(config) {
	const capture = document.createElement('ntc-multiview');

	capture.id = 'capture';
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

	return capture;
}

async function initOCRCapture(config, tabToOpen) {
	console.log('initOCRCapture');

	const driver = new CaptureDriver(config);
	const player = new Player(config);

	driver.addPlayer(player);

	const capture = loadCaptureUI();
	capture.setOCR(player.ocr);
	capture.setGameTracker(player.gameTracker);
	capture.showTab(tabToOpen);
}

async function initFromConfig(tabToOpen) {
	const config = await loadConfig();

	if (config.device_id === 'everdrive') {
		initEverDriveCapture(config, 'ocr_results');
	} else if (config.mode === 'multiviewer') {
		initMultiViewerCapture(config);
	} else {
		initOCRCapture(config, tabToOpen);
	}
}

(async function main() {
	console.log('main');

	// unfortunate bootstrap delay, but makes everything else simpler later on
	await timer.init();

	// load external assets - could parrallelize
	const palettes = await loadPalettes();

	if (hasConfig()) {
		console.log('has config');
		initFromConfig('ocr_results');
	} else {
		const wizard = document.createElement('ntc-wizard');
		document.body.prepend(wizard);

		await new Promise(resolve => {
			wizard.addEventListener('config-ready', resolve, { once: true });
		});

		await sleep(0);
		wizard.remove();
		await sleep(0);

		initFromConfig('calibration');
	}
})();
