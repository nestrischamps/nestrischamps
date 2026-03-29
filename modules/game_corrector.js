import dbPool from './db.js';

import BinaryFrame from '../public/js/BinaryFrame.js';
import BaseGame from '../public/views/BaseGame.js';
import { peek } from '../public/views/utils.js';

// The below is to upload game frames to S3
// That should be refactored into another file
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import zlib from 'zlib';
import config from './config.js';

async function getGameFrames({ frame_file }) {
	console.log(`Fetching game file`);

	const base_url = `https://${config.get('game.frames_bucket')}.s3-${config.get('game.frames_region')}.amazonaws.com/`;
	const frame_url = `${base_url}${frame_file}`;

	const response = await fetch(frame_url);
	const blob = await response.blob();
	const buffer = new Uint8Array(await blob.arrayBuffer());
	const frame_size = BinaryFrame.getFrameSize(buffer);

	const raw_frames = [];

	let idx = 0;

	while (idx < buffer.length) {
		const binary_frame = buffer.slice(idx, idx + frame_size);
		const frame_data = BinaryFrame.parse(binary_frame);

		raw_frames.push({
			binary: binary_frame,
			data: frame_data,
		});

		idx += frame_size;
	}

	return raw_frames;
}

async function getScoreRecords(whereClause) {
	const result = await dbPool.query(
		`
            SELECT id, frame_file
            FROM scores
            WHERE ${whereClause}
        `
	);

	return result.rows;
}

async function updateGameFile(frames, frame_file) {
	const s3Client = new S3Client({ region: config.get('game.frames_region') });
	const zlibStream = zlib.createGzip();

	const upload = new Upload({
		client: s3Client,
		leavePartsOnError: false,
		params: {
			Bucket: config.get('game.frames_bucket'),
			Key: frame_file,
			Body: zlibStream,
			ACL: 'public-read',
			ContentType: 'application/nestrischamps-game-frames',
			ContentEncoding: 'gzip',
			ContentDisposition: 'attachment',
			CacheControl: 'max-age=315360000',
		},
	});

	for (const { binary } of frames) {
		zlibStream.write(binary);
	}

	zlibStream.end();

	await upload.done();
}

async function processGame(game) {
	console.log(game);

	const { id, frame_file } = game;
	const frames = await getGameFrames(game);

	if (!frames || frames.length <= 0) {
		console.log('Unable to fetch game');
		return;
	}

	console.log(
		'First 5 frames',
		frames.slice(0, 5).map(f => f.data.lines)
	);

	// inspect the first 2 frames to correct a potential initial issue
	if (frames[0].data.lines !== 0 && frames[1].data.lines === 0) {
		console.log(`Found bad first frame - discarding`);
		frames.shift(); // drop anomalous first frame
	}

	// replay game in full
	const newGame = new BaseGame({});
	newGame._gameid = id;
	frames.forEach(({ data }) => newGame.setFrame(data));

	const lastPoint = peek(newGame.points);

	let lines = 0;
	let tetris_rate = null;
	let clears = '';

	if (lastPoint.frame.clears.length) {
		// const lastClear = peek(lastPoint.frame.clears);
		const clears_arr = lastPoint.frame.clears.map(({ cleared }) => cleared);
		const tetris_lines = clears_arr
			.filter(n => n === 4)
			.reduce((acc, cur) => acc + cur, 0);

		lines = clears_arr.reduce((acc, cur) => acc + cur, 0);
		clears = clears_arr.join('');
		tetris_rate = tetris_lines / lines;
	}

	const update = [
		lastPoint.score.current, // score
		lines,
		tetris_rate,
		newGame.duration,
		clears,
		id,
	];

	// update db record from game result
	console.log('Updating db record');
	await dbPool.query(
		`
            UPDATE scores
            SET
                score=$1,
                lines=$2,
                tetris_rate=$3,
                duration=$4,
                clears=$5
            WHERE
                id=$6
        `,
		update
	);

	// update save file
	console.log('Updating game file in S3');
	updateGameFile(frames, frame_file); // remove await to do these uploads in parallel?
}

export const correctGames = async whereClause => {
	const games = await getScoreRecords(whereClause);

	for (const game of games) {
		await processGame(game);
	}
};
