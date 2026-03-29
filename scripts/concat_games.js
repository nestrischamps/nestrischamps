// to run this use the command below from ntc root
// npm run concat gameid1 gameid2 gameid3 [...]

import BinaryFrame from '../public/js/BinaryFrame.js';
import { peek } from '../public/views/utils.js';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import zlib from 'zlib';
import BaseGame from '../public/views/BaseGame.js';
import dbPool from '../modules/db.js';

export async function getGameFrames(gameid) {
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

	const then = Date.now();
	let idx = 0;
	const frames = [];

	console.log(`Populating game`);
	while (idx < buffer.length) {
		const binary_frame = buffer.slice(idx, idx + frame_size);
		const frame_data = BinaryFrame.parse(binary_frame);
		frames.push(frame_data);
		idx += frame_size;
	}

	console.log(
		`Done parsing game ${gameid} with ${frames.length} frames in ${
			Date.now() - then
		}ms.`
	);

	return {
		gamedata,
		frames,
	};
}

(async function () {
	const s3Client = new S3Client({ region: process.env.GAME_FRAMES_REGION });
	const gameids = process.argv.slice(2);

	if (gameids.length < 2) {
		throw new Error(`Supply at least 2 gameids`);
	}

	const invalidGameIds = gameids.filter(
		gameid => !/^[1-9][0-9]*$/.test(gameid)
	);

	if (invalidGameIds.length) {
		throw new Error(`Invalid game ids supplied: [${invalidGameIds.join(',')}]`);
	}

	const games = await Promise.all(gameids.map(gameid => getGameFrames(gameid)));

	const file_keys = games.map(game =>
		game.gamedata.frame_url.replace(/^https:\/\/[^/]+\//, '')
	);
	const frame_file = peek(file_keys).replace(/\.ngf$/, '.concat.ngf');

	console.log(`writing to ${frame_file}`);

	const frame_stream = zlib.createGzip();

	const upload = new Upload({
		client: s3Client,
		leavePartsOnError: false,
		params: {
			Bucket: process.env.GAME_FRAMES_BUCKET,
			Key: frame_file,
			Body: frame_stream,
			ACL: 'public-read',
			ContentType: 'application/nestrischamps-game-frames',
			ContentEncoding: 'gzip',
			ContentDisposition: 'attachment',
			CacheControl: 'max-age=315360000',
		},
	});

	const game = new BaseGame({});
	const firstClientGameId = peek(games[0].frames).gameid;

	games
		.map(game => game.frames)
		.flat()
		.forEach(frame => {
			frame.gameid = firstClientGameId;
			frame_stream.write(BinaryFrame.encode(frame));
			game.setFrame(frame);
		});

	frame_stream.end();

	await upload.done();

	console.log(`written to ${frame_file}`);

	// prep update statement
	const lastGameId = peek(gameids);
	const lastPieces = peek(game.pieces);
	const lastPoints = peek(game.points);
	const lastClear = peek(game.clears);

	// warning below actions are destructive
	// note: we use sql concatenation because we know the data types are sql safe - don't do that otherwise!

	// update last game of sequence
	console.log('DB: updating last game');

	let res = await dbPool.query(
		`
			UPDATE scores
				start_level=${game.frames[2].raw.level},
				tetris_rate=${lastClear.tetris_rate},
				num_droughts=${lastPieces.i_droughts.count},
				max_drought=${lastPieces.i_droughts.max},
				das_avg=${lastPieces.das.avg},
				duration=${game.duration},
				clears='${game.clears.map(clear => clear.cleared).join('')}',
				pieces='${game.pieces.map(piece => piece.piece).join('')}',
				transition=${lastPoints.score.transition},
				num_frames=${game.frames.length},
				frame_file='${frame_file}'
			WHERE
				id=${lastGameId}
		`
	);

	if (res.rowCount !== 1) {
		throw new Error(
			`Unexpected number of rows updated: ${res.rowCount} for game id: ${lastGameId}`
		);
	}

	// delete games that were collapsed into one
	console.log('DB: deleting collapsed games (i.e. all but last)');

	const gamesToDelete = gameids.slice(0, -1);

	for (const gameid of gamesToDelete) {
		await dbPool.query(`DELETE from scoresWHERE id=${gameid}`);
	}

	// And remove the old frame files
	console.log(`Deleting old frame files in S3: \n${file_keys.join('\n')}`);

	const deleteCmdInput = {
		Bucket: process.env.GAME_FRAMES_BUCKET,
		Delete: {
			Objects: file_keys.map(key => ({ Key: key })),
			Quiet: false,
		},
	};
	const command = new DeleteObjectsCommand(deleteCmdInput);

	await s3Client.send(command);
})();
