import zlib from 'zlib';
import fs from 'fs';
import _ from 'lodash';
import express from 'express';
import got from 'got';
import ScoreDAO from '../daos/ScoreDAO.js';
import UserDAO from '../daos/UserDAO.js';
import ScoreService, {
	handleUpdateScoreCompetition,
} from '../domains/ScoreService.js';
import config from '../modules/config.js';

const STACKRABBIT_URL = 'https://stackrabbit.herokuapp.com/get-move';

const router = express.Router();

function parseStackRabbitRequest(query) {
	if (!query.board || !/^[01]{200}$/.test(query.board))
		throw new Error(`Invalid Board: ${query.board}`);
	if (!query.currentPiece || !/^[TJZOSLI]$/.test(query.currentPiece))
		throw new Error('Invalid Current Piece');
	if (!query.nextPiece || !/^[TJZOSLI]$/.test(query.nextPiece))
		throw new Error('Invalid Next Piece');
	if (!query.level || !/^1[89]$/.test(query.level))
		throw new Error('Invalid Level');
	if (!query.lines || !/^\d{1,3}$/.test(query.lines))
		throw new Error('Invalid Lines');
	if (!query.reactionTime || !/^\d{2}$/.test(query.reactionTime))
		throw new Error('Invalid reactionTime');
	if (!query.inputFrameTimeline || !/^[X.]{5}$/.test(query.inputFrameTimeline))
		throw new Error('Invalid inputFrameTimeline');

	return _.pick(query, [
		'board',
		'currentPiece',
		'nextPiece',
		'level',
		'lines',
		'reactionTime',
		'inputFrameTimeline',
	]);
}

router.get('/is_public_server', (req, res) => {
	res.json({ is_public_server: config.get('server.is_public') });
});

// proxy to stack rabbit engine API
// careis taken to make sure only valid requests are forwarded
router.get('/recommendation', async (req, res) => {
	let searchParams;
	try {
		searchParams = parseStackRabbitRequest(req.query);
	} catch (err) {
		console.error(err);
		res.status(400).json({ error: err.message });
		return;
	}

	let data;
	try {
		const then = Date.now();
		data = await got(STACKRABBIT_URL, { searchParams }).text();
		console.log(`Stack Rabbit response in ${Date.now() - then}`);
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
		return;
	}

	res.send(data);
});

router.get('/files/games/:id/:bucket/:filename', async (req, res) => {
	if (
		!/^[1-9]\d*$/.test(req.params.id) ||
		!/^[0-9A-Z]+$/.test(req.params.bucket) ||
		!/^[0-9A-Z]+.ngf$/.test(req.params.filename)
	) {
		res.status(400).json({ error: 'Invalid Request' });
		return;
	}

	fs.createReadStream(
		`games/${req.params.id}/${req.params.bucket}/${req.params.filename}`
	)
		.pipe(zlib.createGunzip())
		.pipe(res);
});

router.get('/games/:id', async (req, res) => {
	if (!/^[1-9]\d*$/.test(req.params.id)) {
		res.status(400).json({ error: 'Invalid Game id' });
		return;
	}

	const game = await ScoreDAO.getAnonymousScore(req.params.id);

	if (!game) {
		res.status(404).json({ error: `Game id ${req.params.id} not found` });
		return;
	}

	if (config.get('game.frames_bucket')) {
		const base_url = `https://${config.get('game.frames_bucket')}.s3-${config.get('game.frames_region')}.amazonaws.com/`;

		game.frame_url = `${base_url}${game.frame_file}`;
	} else {
		game.frame_url = `${req.protocol}://${req.headers.host}/api/files/${game.frame_file}`;
	}

	res.json(game);
});

const SECRET_REGEX = /^([0-9A-Z]{26}|PLAYER[1-9]\d*)$/i; // ulid or hardcoded player secret

function extractSecret(req, res, next) {
	const secretHeader = req.headers['x-ntc-secret'];
	const isValid = SECRET_REGEX.test(secretHeader);

	if (!isValid) {
		return res.status(401).json({ error: 'Invalid or missing Bearer token' });
	}

	req.secret = secretHeader;

	next();
}

async function checkUser(req, res, next) {
	const user = await UserDAO.getUserBySecret(req.secret);

	if (!user) {
		return res.status(401).json({ error: 'User not found' });
	}

	req.user = user;

	next();
}

async function handleGetScores(req, res) {
	const { scores, total_scores, num_pages, options } =
		await ScoreService.fetchPage(req.user, req.query, req);

	res.json({
		scores,
		pagination: {
			total_scores,
			page_idx: options.page_idx,
			page_size: options.page_size,
			num_pages,
		},
		query: {
			sort_field: options.sort_field,
			sort_order: options.sort_order,
			level: options.level,
			competition: options.competition,
		},
	});
}

router.get('/user/scores', extractSecret, checkUser, handleGetScores);
router.get('/user/scores/:id', extractSecret, checkUser, async (req, res) => {
	if (!/^[1-9]\d*$/.test(req.params.id)) {
		res.status(400).json({ error: 'Invalid Score id' });
		return;
	}

	const score = await ScoreDAO.getScore(req.user, req.params.id);

	if (!score) {
		res.status(404).json({ error: `Score id ${req.params.id} not found` });
		return;
	}

	if (score.frame_file) {
		if (config.get('game.frames_bucket')) {
			const base_url = `https://${config.get('game.frames_bucket')}.s3-${config.get('game.frames_region')}.amazonaws.com/`;
			score.frame_url = `${base_url}${score.frame_file}`;
		} else {
			score.frame_url = `${req.protocol}://${req.headers.host}/api/files/${score.frame_file}`;
		}
	}

	res.json(score);
});

router.put(
	'/user/scores/:id/competition/:mode',
	extractSecret,
	checkUser,
	handleUpdateScoreCompetition
);

function validateRpcBody(req, res, next) {
	// We validate against the exact same message format for rpc commands as the websocket
	// i.e. array of format [command, ...args]
	// TODO: could consider accepting more expressive json payloads instead
	// TODO: use zod to specify the message commands and their args types explicitly
	do {
		if (!Array.isArray(req.body)) break;

		switch (req.body[0]) {
			case 'setDisplayName':
			case 'setCountryCode':
			case 'setVictories':
			case 'resetVictories':
			case 'setBestOf':
			case 'setMatch':
				return next();
		}

		// eslint-disable-next-line no-constant-condition
	} while (false);

	return res.status(400).json({ error: 'Invalid RPC command' });
}

router.post(
	'/host/rpc',
	extractSecret,
	checkUser,
	express.json(),
	validateRpcBody,
	async (req, res) => {
		req.user.getHostRoom().handleAdminMessage(req.body);
		res.json({ success: true, command: req.body });
	}
);

// global 404 handler for API
router.use((req, res) => {
	res.status(404).json({ error: 'Invalid api route' });
});

// Optional: error handler
router.use((err, req, res) => {
	console.error('Unhandled error:', err);
	res.status(500).json({ error: 'Server error' });
});

export default router;
