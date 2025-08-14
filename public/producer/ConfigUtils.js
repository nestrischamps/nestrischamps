import QueryString from '/js/QueryString.js';
import BinaryFrame from '/js/BinaryFrame.js';
import { appStore } from './AppStore.js';

function getConfigName() {
	return QueryString.get('config') || 'config';
}

export function hasConfig() {
	const maybeConfig = localStorage.getItem(getConfigName());
	if (!maybeConfig) return false;

	// minimal checks for validity of the config object
	// could add comprehensive verification later
	// for now guard against initial calibration not completed
	try {
		const parsed = JSON.parse(maybeConfig);
		if (parsed?.device_id === 'everdrive') return true;

		// For OCR capture, we check that the task list is valid

		if (!parsed?.tasks) return false;

		const tasks = Object.values(parsed.tasks);
		if (tasks.length <= 0) return false;
		if (!tasks.every(task => !!task.crop)) return false;
	} catch (err) {
		return false;
	}

	return true;
}

export function getGameTypeFromTasks(tasks) {
	return tasks.T
		? BinaryFrame.GAME_TYPE.CLASSIC
		: tasks.cur_piece_das
			? BinaryFrame.GAME_TYPE.DAS_TRAINER
			: BinaryFrame.GAME_TYPE.MINIMAL;
}

export function loadConfig() {
	const config = localStorage.getItem(getConfigName());

	if (config) {
		const parsed = JSON.parse(config);

		if (!parsed.hasOwnProperty('game_type')) {
			parsed.game_type = getGameTypeFromTasks(parsed.tasks);
		}

		Object.entries(parsed.tasks).forEach(([name, task]) => (task.name = name));

		parsed.save = function () {
			saveConfig(this);
		};

		return parsed;
	}
}

export function saveConfig(config) {
	console.log('saveConfig');

	const {
		device_id,
		game_type,
		palette,
		frame_rate,
		focus_alarm,
		allow_video_feed,
		video_feed_device_id,
		brightness,
		contrast,
		score7,
		use_half_height,
		use_worker_for_interval,
		handle_retron_levels_6_7,
	} = config;

	// need to drop non-serializable fields
	const config_copy = {
		device_id,
		game_type,
		palette,
		frame_rate,
		focus_alarm,
		allow_video_feed,
		video_feed_device_id,
		brightness,
		contrast,
		score7,
		use_half_height,
		use_worker_for_interval,
		handle_retron_levels_6_7,
		tasks: {},
	};

	for (const [name, task] of Object.entries(config.tasks)) {
		config_copy.tasks[name] = { ...task };
	}

	localStorage.setItem(getConfigName(), JSON.stringify(config_copy));

	appStore.setState({ config });
}

export function clearConfigAndReset() {
	if (
		confirm(
			'You are about to remove your current configuration. You will have to recalibrate. Are you sure?'
		)
	) {
		localStorage.removeItem(getConfigName());
		location.reload();
	}
}

export function getDefaultOcrConfig() {
	return {
		game_type: 1,
		palette: '',
		frame_rate: 60,
		focus_alarm: true,
		allow_video_feed: false,
		video_feed_device_id: null,
		brightness: 1,
		contrast: 1,
		score7: false,
		use_half_height: false,
		use_worker_for_interval: true,
		handle_retron_levels_6_7: false,
		tasks: {},
		save: function () {
			saveConfig(this);
		},
	};
}
