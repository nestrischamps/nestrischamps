// to run this use the command below from ntc root
// npm run concat gameid1 gameid2 gameid3 [...]

import BinaryFrame from '../public/js/BinaryFrame.js';
import { peek } from '../public/views/utils.js';
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
	const gameid = process.argv[2];

	if (!/^[1-9][0-9]*$/.test(gameid)) {
		throw new Error(`Invalid game id supplied: [${gameid}]`);
	}

	const data = await getGameFrames(gameid);
	const game = new BaseGame({});

	data.frames.forEach(frame => game.setFrame(frame));

	// prep update statement
	const lastPiece = peek(game.pieces);
	const lastPoint = peek(game.points);
	const lastClear = peek(game.clears);

	// warning below actions are destructive
	// note: we use sql concatenation because we know the data types are sql safe - don't do that otherwise!

	// update last game of sequence

	let fetchResult = await dbPool.query(
		`select * from scores where id=${gameid}`
	);

	console.log('BEFORE');
	console.log(JSON.stringify(fetchResult.rows[0], null, 2));
	console.log();

	const sql = `
        UPDATE scores
        SET
            start_level=${game.frames[2].raw.level},
            tetris_rate=${lastClear?.tetris_rate ?? null},
            num_droughts=${lastPiece.i_droughts.count},
            max_drought=${lastPiece.i_droughts.max},
            das_avg=${lastPiece.das.avg},
            duration=${game.duration},
            clears='${game.clears.map(clear => clear.cleared).join('')}',
            pieces='${game.pieces.map(piece => piece.piece).join('')}',
            transition=${lastPoint.score.transition},
            num_frames=${game.frames.length}
        WHERE
            id=${gameid}
        ;
    `;

	console.log('AFTER');
	console.log(sql);

	let res = await dbPool.query(sql);

	if (res.rowCount !== 1) {
		throw new Error(
			`Unexpected number of rows updated: ${res.rowCount} for game id: ${gameid}`
		);
	}

	console.log(`Updated gameid ${gameid}`);
	process.exit(0);
})();
