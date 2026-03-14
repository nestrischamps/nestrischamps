import express from 'express';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import middlewares from '../modules/middlewares.js';
import UserDAO from '../daos/UserDAO.js';
import ScoreDAO from '../daos/ScoreDAO.js';
import config from '../modules/config.js';

const router = express.Router();

router.get('/get_stats/:secret', async (req, res) => {
	const user = await UserDAO.getUserBySecret(req.params.secret);

	if (!user) {
		res.status(404).send('User Not found');
		return;
	}

	res.json(await ScoreDAO.getStats(user));
});

router.get('/pb/:secret', async (req, res) => {
	const user = await UserDAO.getUserBySecret(req.params.secret);

	if (!user) {
		res.status(404).send('User Not found');
		return;
	}

	let since = 0;

	console.log('PB request', req.query.since, Date.now());

	if (/^\d+$/.test(req.query.since)) {
		// since is supplied in ms since epoch
		// but we need it in second since epoch
		since = Math.floor(parseInt(req.query.since, 10) / 1000);
	}

	res.json(await ScoreDAO.getPB(user, since));
});

router.get('/top3/:secret', async (req, res) => {
	const user = await UserDAO.getUserBySecret(req.params.secret);

	if (!user) {
		res.status(404).send('User Not found');
		return;
	}

	let since = 0;

	console.log('Top 3 request', req.query.since, Date.now());

	if (/^\d+$/.test(req.query.since)) {
		// since is supplied in ms since epoch
		// but we need it in second since epoch
		since = Math.floor(parseInt(req.query.since, 10) / 1000);
	}

	res.json(await ScoreDAO.getTop3(user, since));
});

router.get(
	'/u/:login/get_stats',
	middlewares.assertSession,
	middlewares.checkToken,
	async (req, res) => {
		console.log('get stats by login');

		const user = await UserDAO.getUserByLogin(req.params.login);

		if (!user) {
			res.status(404).send('User Not found');
			return;
		}

		res.json(await ScoreDAO.getStats(user));
	}
);

router.get(
	'/get_stats',
	middlewares.assertSession,
	middlewares.checkToken,
	async (req, res) => {
		console.log('get stats by session');

		const user = await UserDAO.getUserById(req.session.user.id);

		if (!user) {
			res.status(404).send('User Not found');
			return;
		}

		res.json(await ScoreDAO.getStats(user));
	}
);

router.post('/report_game/:secret', express.json(), async (req, res) => {
	console.log('Reporting game by secret');

	const user = await UserDAO.getUserBySecret(req.params.secret);

	if (!user) {
		res.status(404).send('User Not found');
		return;
	}

	console.log(`Found user ${user.login}`);

	/*
	// Game is reported server-ide now, no need to record here

	let game_data = req.body;
	let normalized_report;

	try {
		normalized_report = {
			start_level:  game_data.start_level,
			end_level:    game_data.level,
			score:        game_data.score.current    || 0,
			lines:        game_data.lines.count      || 0,
			tetris_rate:  game_data.lines[4].percent || 0,
			num_droughts: game_data.i_droughts.count || 0,
			max_drought:  game_data.i_droughts.max   || 0,
			das_avg:      game_data.das.avg          || 0,
			duration:     game_data.duration         || 0,
			transition:   game_data.score.transition || null,
		};

		if (game_data.timeline) {
			normalized_report.clears = game_data.timeline.clears || '';
			normalized_report.pieces = game_data.timeline.pieces || '';
		}
	}
	catch (err) {
		console.error('Invalid game data');
		res.status(400).send('Invalid Game Data');
		return;
	}

	console.log('Game data is good');

	try {
		await ScoreDAO.recordGame(user, normalized_report);
	}
	catch(err) {
		console.log('Unable to record game');
		console.error(err);
	}

	console.log('Game is recorded!');
	/**/

	res.json(await ScoreDAO.getStats(user));

	console.log('Sent new scores back');
});

function range(min, max) {
	return Array(max - min + 1)
		.fill()
		.map((_, idx) => min + idx);
}

function getPages(page_idx, num_pages) {
	const side = 2;
	const ellipsis_spread = 2;
	const max_tokens = 5 + side * 2; // sides x 2 + first + last + page + start ellipsis + end ellipsis

	let cur_page_num = page_idx + 1;
	let pages;

	if (num_pages <= max_tokens) {
		pages = range(1, num_pages);
	} else {
		const needs_lead = page_idx - 0 > side + ellipsis_spread;
		const needs_tail = num_pages - page_idx - 1 > side + ellipsis_spread;

		if (needs_lead && needs_tail) {
			pages = range(cur_page_num - side, cur_page_num + side);
			pages.unshift(1, '...');
			pages.push('...', num_pages);
		} else if (needs_lead) {
			pages = range(num_pages - max_tokens + 3, num_pages);
			pages.unshift(1, '...');
		} else if (needs_tail) {
			pages = range(1, max_tokens - 2);
			pages.push('...', num_pages);
		}
	}

	return pages;
}

function getCompetitionFilter(req, res, next) {
	const filter = {};

	if (/^[01]|true|false$/.test(req.query.competition)) {
		filter.competition = /^1|true$/.test(req.query.competition);
		filter.current = filter.competition
			? 'Competition scores'
			: 'Non-Competition scores';
		filter.links = [
			filter.competition
				? { text: 'show non-competition scores', href: '#competition=0' }
				: { text: 'show competition scores', href: '#competition=1' },
			{ text: 'show all scores', href: '#' },
		];
	} else {
		filter.competition = null;
		filter.current = 'All scores';
		filter.links = [
			{ text: 'show competition scores', href: '#competition=1' },
			{ text: 'show non-competition scores', href: '#competition=0' },
		];
	}

	req.ntc = Object.assign(req.ntc || {}, { filter });

	next();
}

router.get(
	'/scores',
	middlewares.assertSession,
	middlewares.checkToken,
	getCompetitionFilter,
	async (req, res) => {
		console.log(`Fetching user scores for ${req.session.user.id}`);

		const PAGE_SIZE = 100;
		const ALLOWED_ORDER_FIELDS = [
			'datetime',
			'lines',
			'score',
			'tetris_rate',
			'num_droughts',
			'max_drought',
			'level',
		];
		const ALLOWED_ORDER_DIRS = ['desc', 'asc'];

		const options = {
			sort_field: 'datetime',
			sort_order: 'desc',
			page_idx: 0,
			competition: null,
			level: null,
		};

		// validate and get args from query
		if (ALLOWED_ORDER_FIELDS.includes(req.query.sort_field)) {
			options.sort_field = req.query.sort_field;
		}

		if (ALLOWED_ORDER_DIRS.includes(req.query.sort_order)) {
			options.sort_order = req.query.sort_order;
		}

		if (/^\d+$/.test(req.query.page_idx)) {
			options.page_idx = parseInt(req.query.page_idx, 10);
		}

		if (/^[12]?\d$/.test(req.query.level)) {
			options.level = parseInt(req.query.level, 10);
		}

		options.competition = req.ntc.filter.competition;

		const num_scores = await ScoreDAO.getNumberOfScores(
			req.session.user,
			options
		);

		const num_pages = Math.ceil(num_scores / PAGE_SIZE) || 1;

		options.page_idx = Math.max(0, Math.min(options.page_idx, num_pages - 1));

		// WARNING: when we supply pagination parameters here, all field MUST be sanitized because getScorePage() interpolates them to construct the SQL query
		const scores = await ScoreDAO.getScorePage(req.session.user, options);

		res.render('scores', {
			scores,
			num_pages,
			pagination: options,
			filter: req.ntc.filter,
			pages: getPages(options.page_idx, num_pages),
		});
	}
);

router.get(
	'/scores/:id',
	middlewares.assertSession,
	middlewares.checkToken,
	async (req, res) => {
		console.log(
			`User ${req.session.user.id} is getting score ${req.params.id}`
		);
		const score = await ScoreDAO.getScore(req.session.user, req.params.id);

		if (score) {
			if (score.frame_file) {
				score.frame_file_url = `${config.get('game.frames_baseurl')}${score.frame_file}`;

				delete score.frame_file;
			}
		}

		res.json(score);
	}
);

router.delete(
	'/scores/:id',
	middlewares.assertSession,
	middlewares.checkToken,
	async (req, res) => {
		console.log(
			`User ${req.session.user.id} is deleting score ${req.params.id}`
		);

		const score = await ScoreDAO.getScore(req.session.user, req.params.id);

		await ScoreDAO.deleteScore(req.session.user, req.params.id);

		if (score && score.frame_file) {
			const s3_client = new S3Client({
				region: config.get('game.frames_region'),
			});

			// fire and forget, and log
			s3_client
				.send(
					new DeleteObjectCommand({
						Bucket: config.get('game.frames_bucket'),
						Key: score.frame_file,
					})
				)
				.then(
					() =>
						console.log(
							`Deleted game ${req.params.id}'s' file ${score.frame_file}`
						),
					err =>
						console.log(
							`Unable to delete game ${req.params.id}'s' file ${score.frame_file}: ${err.message}`
						)
				);
		}

		res.json({ status: 'ok' });
	}
);

router.put(
	'/scores/:id/competition/:mode',
	middlewares.assertSession,
	middlewares.checkToken,
	async (req, res) => {
		console.log(`Updating score ${req.params.id}`);

		if (!['0', '1'].includes(req.params.mode)) {
			res.status(400).send('Invalid value for competition mode');
			return;
		}

		try {
			await ScoreDAO.updateScore(
				req.session.user,
				req.params.id,
				req.params.mode === '1'
			);
			res.json({ status: 'ok' });
		} catch (err) {
			console.error(err);
			res.status(500).send('Unable to update score');
		}
	}
);

router.get(
	'/progress/data',
	middlewares.assertSession,
	middlewares.checkToken,
	getCompetitionFilter,
	async (req, res) => {
		const progress = await ScoreDAO.getProgress(req.session.user, {
			competition: req.ntc.filter.competition,
		});

		progress.forEach(datapoint => {
			datapoint.timestamp = datapoint.datetime.getTime();
			delete datapoint.date;
		});

		res.json(progress);
	}
);

router.get(
	'/progress/data-1819',
	middlewares.assertSession,
	middlewares.checkToken,
	getCompetitionFilter,
	async (req, res) => {
		const data = {};

		for (const start_level of [18, 19, 29]) {
			const progress = await ScoreDAO.getProgress(req.session.user, {
				start_level,
				competition: req.ntc.filter.competition,
			});

			progress.forEach(datapoint => {
				datapoint.timestamp = datapoint.datetime.getTime();
				delete datapoint.date;
			});

			data[start_level] = progress;
		}

		res.json(data);
	}
);

router.get(
	'/progress',
	middlewares.assertSession,
	middlewares.checkToken,
	getCompetitionFilter,
	async (req, res) => {
		res.render('progress', {
			filter: req.ntc.filter,
		});
	}
);

export default router;
