import fs from 'fs';
import BinaryFrame from '../public/js/BinaryFrame.js';
import BaseGame from '../public/views/BaseGame.js';
import { peek } from '../public/views/utils.js';

export async function getReplayGame(gameid) {
	const game_url = `https://nestrischamps.io/api/games/${gameid}`;
	console.log(`Fetching game data for gameid ${gameid}`);

	const gamedata_res = await fetch(game_url);
	const gamedata = await gamedata_res.json();

	if (!gamedata.frame_url) {
		return { gamedata };
	}

	console.log(`Fetching game file at url ${gamedata.frame_url}`);
	const response = await fetch(gamedata.frame_url);
	const blob = await response.blob();
	const buffer = new Uint8Array(await blob.arrayBuffer());
	const version = BinaryFrame.getFrameVersion(buffer);
	const frame_size = BinaryFrame.getFrameSize(buffer);

	console.log({
		header: buffer[0].toString(2).padStart(8, '0'),
		version,
		frame_size,
	});

	const raw_frames = [];
	const game = new BaseGame({});
	game._gameid = gameid; // game has a client id, this records the server id too, can be used later on

	const then = Date.now();
	let idx = 0;

	console.log(`Populating game`);
	while (idx < buffer.length) {
		const binary_frame = buffer.slice(idx, idx + frame_size);
		const frame_data = BinaryFrame.parse(binary_frame);

		raw_frames.push(frame_data);
		game.setFrame(frame_data);

		idx += frame_size;
	}

	console.log(
		`Done parsing game ${gameid} with ${game.frames.length} frames in ${
			Date.now() - then
		}ms.`
	);

	return {
		gamedata,
		game,
		raw_frames,
	};
}

function noop() {}

function getSrtTimestamp(elapsed) {
	let remainder = elapsed;

	const ms = `${remainder % 1000}`;
	remainder = (remainder / 1000) | 0;

	const sec = `${remainder % 60}`;
	remainder = (remainder / 60) | 0;

	const mins = `${remainder % 60}`;
	const hours = `${(remainder / 60) | 0}`;

	return `${hours.padStart(2, '0')}:${mins.padStart(2, '0')}:${sec.padStart(
		2,
		'0'
	)},${ms.padStart(3, '0')}`;
}

(async function () {
	const gameid = process.argv[2] || 241366;
	const video_offset_ms = parseInt(process.argv[3], 10) || 0; // offset in ms to align with video file
	const { gamedata, game, raw_frames } = await getReplayGame(gameid);

	if (!game) {
		console.log('Unable to fetch game');
		return;
	}

	const start_ctime = game.frames[0].raw.ctime;
	const duration = game.duration;

	let file_name = `${gameid}_${gamedata.login}`;

	console.log(`Computing report`);

	// JSON export
	const report = {
		id: gamedata.id,
		login: gamedata.login,
		start_level: gamedata.start_level,
		points: game.points.map(p => {
			const clear = peek(p.frame.clears) || {};
			const ts = p.frame.raw.ctime - start_ctime;
			return {
				ts,
				gameid: p.frame.raw.gameid,
				time: getSrtTimestamp(ts),
				lines: p.frame.raw.lines,
				level: p.frame.raw.level,
				cleared: p.cleared,
				burn: clear.burn || 0,
				tetris_rate: clear.tetris_rate || 0,
				efficiency: clear.efficiency || 0,
				raw_score: p.frame.raw.score,
				score: p.score.current,
			};
		}),
	};

	console.log(`Writing report into file ${file_name}.json`);
	fs.writeFile(`${file_name}.json`, JSON.stringify(report, null, 2), noop);

	// CSV export - Note: it's not a proper csv encoder, but it works because we know the data is csv-safe
	console.log(`Writing report into file ${file_name}.csv`);
	const csv_data = report.points.map(data => {
		const row = Object.values(data);
		row[2] = `"${row[2]}"`; // SRT timestamps contain a comma, so we wrap the entry for CSV safety
		return row;
	});
	csv_data.unshift(Object.keys(report.points[0])); // prepend headers
	fs.writeFile(`${file_name}.csv`, csv_data.join('\n'), noop);

	if (video_offset_ms) {
		console.log(`SRT and Chapters written with ${video_offset_ms}ms offset.`);
	}

	// generate subtitle srt file
	const srt = report.points.map((p, idx) => {
		const next = report.points[idx + 1] || { ts: duration };
		return [
			idx + 1,
			`${getSrtTimestamp(video_offset_ms + p.ts)} --> ${getSrtTimestamp(
				video_offset_ms + next.ts - 1
			)}`,
			`score: ${p.score} - lines: ${p.lines}`,
			`cleared: ${p.cleared} - tetris rate: ${(p.tetris_rate * 100).toFixed(
				1
			)}`,
		].join('\n');
	});

	console.log(`Writing subtitle into file ${file_name}.srt`);
	fs.writeFile(`${file_name}.srt`, srt.join('\n\n'), noop);

	// generate chapter marker file
	const chapters = report.points.map((p, idx) => {
		const next = report.points[idx + 1] || { ts: duration };
		return [
			'[CHAPTER]',
			'TIMEBASE=1/1000',
			`START=${video_offset_ms + p.ts}`,
			`END=${video_offset_ms + next.ts - 1}`,
			`TITLE=score: ${p.score} - lines: ${p.lines} - cleared: ${
				p.cleared
			} - tetris rate: ${(p.tetris_rate * 100).toFixed(1)}`,
		].join('\n');
	});

	console.log(`Writing chapters into file ${file_name}.txt`);
	fs.writeFile(`${file_name}.txt`, chapters.join('\n\n'), noop);

	// generate all-frames report
	console.log(`Writing frame report into file ${file_name}_frames.csv`);
	const frames_csv = raw_frames.map(data => {
		data.field = data.field.join('');
		return Object.values(data);
	});
	frames_csv.unshift(Object.keys(raw_frames[0]));
	fs.writeFile(`${file_name}_frames.csv`, frames_csv.join('\n'), noop);
})();
