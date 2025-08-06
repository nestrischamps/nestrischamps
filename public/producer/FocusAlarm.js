import { timer } from './timer.js';
import speak from '/views/tts.js';

const UNFOCUSED_ALARM_SND = new Audio('/ocr/alarm.mp3');
// const UNFOCUSED_SILENCE_SND = new Audio('/ocr/silence.mp3');
const UNFOCUSED_ALARM_LOOPS = 4;

let target_interval = 1000 / 10; // 30 fps
let last_frame_time = 0;

let unfocused_alarm_loop_counter = 0;
let unfocused_abnormal_elapsed = 750; // If capture interval runs at 750ms, capture is messed up
let unfocused_alarm_playing = false;

let unfocused_smoothing_factor = 1 / 15; // causes roughly 20s delay from when interval jumps from 33ms to 1000ms
let unfocused_smoothed_elapsed = 0;

function playUnfocusedAlarm() {
	if (!unfocused_alarm_playing) return;

	unfocused_alarm_loop_counter =
		++unfocused_alarm_loop_counter % UNFOCUSED_ALARM_LOOPS;

	if (unfocused_alarm_loop_counter === 0) {
		// Say Message
		delete UNFOCUSED_ALARM_SND.onended;
		speak(
			{
				username: '_system',
				display_name: 'System',
				message: 'Warning! Nestris champs OCR page is not active!',
			},
			{ now: true, callback: playUnfocusedAlarm }
		);
	} else {
		// Play alarm
		UNFOCUSED_ALARM_SND.onended = playUnfocusedAlarm;
		UNFOCUSED_ALARM_SND.play();
	}
}

function startUnfocusedAlarm() {
	if (unfocused_alarm_playing) return;

	unfocused_alarm_playing = true;
	unfocused_alarm_loop_counter = 0;
	playUnfocusedAlarm();

	// play silence sound continuously to disable timer throttling
	// UNFOCUSED_SILENCE_SND.loop = true;
	// UNFOCUSED_SILENCE_SND.play();

	window.addEventListener('focus', stopUnfocusedAlarm);
}

function stopUnfocusedAlarm() {
	delete UNFOCUSED_ALARM_SND.onended;
	unfocused_alarm_playing = false;
	unfocused_smoothed_elapsed = 0;

	UNFOCUSED_ALARM_SND.pause();
	// UNFOCUSED_SILENCE_SND.pause();

	window.removeEventListener('focus', stopUnfocusedAlarm);
}

function monitor() {
	++frame_count;

	const now = Date.now();

	if (last_frame_time) {
		const elapsed = now - last_frame_time;

		unfocused_smoothed_elapsed =
			unfocused_smoothing_factor * elapsed +
			(1 - unfocused_smoothing_factor) * unfocused_smoothed_elapsed;

		if (unfocused_smoothed_elapsed > unfocused_abnormal_elapsed) {
			startUnfocusedAlarm();
		}
	}

	last_frame_time = now;
}

let monitorId = null;

export function enableFocusMonitoring() {
	monitorId = timer.clearInterval(monitorId);
	monitorId = timer.setInterval(monitor, target_interval);
}

export function disableFocusMonitoring() {
	stopUnfocusedAlarm();
	monitorId = timer.clearInterval(monitorId);
}
