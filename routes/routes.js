import path from 'path';
import express from 'express';

import middlewares from '../modules/middlewares.js';
import { countries } from '../modules/countries.js';
import layouts from '../modules/layouts.js';
import UserDAO from '../daos/UserDAO.js';
import ScoreDAO from '../daos/ScoreDAO.js';

const router = express.Router({ caseSensitive: true });

router.get('/debug/session', (req, res) => {
	res.send(JSON.stringify(req.session));
});

router.get('/', (req, res) => {
	res.render('intro');
});

router.get('/privacy', (req, res) => {
	res.render('privacy');
});

router.get('/terms', (req, res) => {
	res.render('terms');
});

router.get(
	'/room/admin',
	middlewares.assertSession,
	middlewares.checkToken,
	async (req, res) => {
		const data = { countries };

		if (process.env.IS_PUBLIC_SERVER === '1') {
			data.users = null;
		} else {
			data.users = await UserDAO.getAssignableUsers();

			// Drop seed prefix (if any) - seed does not matter in admin view
			// Being able to search players by name is much more important!
			data.users.forEach(
				u => (u.display_name = u.display_name?.replace(/^\d+\.\s+/, '') || '')
			);
			data.users.sort((u1, u2) => {
				return u1.display_name.toLowerCase() < u2.display_name.toLowerCase()
					? -1
					: 1;
			});
		}

		res.render('admin', data);
	}
);

/*
router.get(
	'/room/u/:login/admin',
	middlewares.assertSession,
	middlewares.checkToken,
	async (req, res) => {
		const target_user = await UserDAO.getUserByLogin(req.params.login);

		if (!target_user) {
			res.status(404).send('Target User Not found');
			return;
		}

		res.render('admin', { countries });
	}
);
/**/

router.get(/^\/remote_calibration/, (req, res) => {
	res.sendFile(
		path.join(path.resolve(), `public/producer/remote_calibration.html`)
	);
});

router.get(
	/^\/room\/(producer2?|emu)/,
	middlewares.assertSession,
	middlewares.checkToken,
	(req, res) => {
		console.log('/room/producer');
		const tplPath = /producer2/.test(req.path)
			? '/producer/index.html'
			: /producer/.test(req.path)
				? '/ocr/ocr.html'
				: '/emu/index.html';

		res.sendFile(path.join(path.resolve(), `public${tplPath}`));
	}
);

// access producer by url secret
router.get(
	/^\/room\/u\/([^/]+)\/(producer2?|emu)\/([a-zA-Z0-9-]+)/,
	async (req, res) => {
		const host_user = await UserDAO.getUserByLogin(req.params[0]);

		if (!host_user) {
			res.status(404).send('Target User Not found');
			return;
		}

		const player = await UserDAO.getUserBySecret(req.params[2]);

		if (!player) {
			res.status(400).send('Player Not found');
			return;
		}

		const tplPath = /producer2/.test(req.path)
			? '/producer/index.html'
			: /producer/.test(req.path)
				? '/ocr/ocr.html'
				: '/emu/index.html';

		console.log([req.path, tplPath]);

		res.sendFile(path.join(path.resolve(), `public${tplPath}`));
	}
);

router.get(
	/^\/room\/u\/([^/]+)\/(producer2?|emu)/,
	middlewares.assertSession,
	middlewares.checkToken,
	async (req, res) => {
		const target_user = await UserDAO.getUserByLogin(req.params[0]);

		if (!target_user) {
			res.status(404).send('Target User Not found');
			return;
		}

		const tplPath = /producer2/.test(req.path)
			? '/producer/index.html'
			: /producer/.test(req.path)
				? '/ocr/ocr.html'
				: '/emu/index.html';

		res.sendFile(path.join(path.resolve(), `public${tplPath}`));
	}
);

router.get(
	'/room/u/:login/view/:layout',
	middlewares.assertSession,
	middlewares.checkToken,
	async (req, res) => {
		const target_user = await UserDAO.getUserByLogin(req.params.login);

		if (!target_user) {
			res.status(404).send('Target User Not found');
			return;
		}

		const layout = layouts[req.params.layout];

		if (!layout) {
			res.status(404).send('Layout Not found');
			return;
		}

		res.sendFile(
			path.join(
				path.resolve(),
				`public/views/${layout.type}/${layout.file}.html`
			)
		);
	}
);

router.get(
	'/room/view/:layout',
	middlewares.assertSession,
	middlewares.checkToken,
	async (req, res) => {
		const layout = layouts[req.params.layout];

		if (!layout) {
			res.status(404).send('Layout Not found');
			return;
		}

		res.sendFile(
			path.join(
				path.resolve(),
				`public/views/${layout.type}/${layout.file}.html`
			)
		);
	}
);

router.get(
	'/renderers',
	middlewares.assertSession,
	middlewares.checkToken,
	(req, res) => {
		res.render('renderers', {
			secret: req.session.user.secret,
			layouts,
		});
	}
);

function getAge(dob) {
	const now = new Date();
	const today_str = now.toISOString().slice(0, 10);
	const today = new Date(today_str);
	const m = today.getMonth() - dob.getMonth();

	let age = today.getFullYear() - dob.getFullYear();

	if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
		age--;
	}

	return age;
}

function mapObject(obj, fn) {
	return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}

const usNumFormatter = new Intl.NumberFormat('en-US', {
	maximumFractionDigits: 0,
});

router.get('/view/profile_card/:login', async (req, res) => {
	const user = await UserDAO.getUserByLogin(req.params.login, true);

	if (!user) {
		res.status(404).send('Not found');
		return;
	}

	const pbs = await ScoreDAO.getPBs181929(user);

	res.render('profile_card', {
		user,
		age: user.dob ? getAge(user.dob) : 9, // 😅
		pbs: mapObject(pbs, v => (v ? usNumFormatter.format(v) : 0)),
		elo_rating: usNumFormatter.format(Math.floor(user.elo_rating)),
	});
});

// TODO: uniformalize the alyout and file names
// TODO: AND uniformalize the way the layout understnd incoming data

// TODO: construct the routes based on available layouts - That will allow express to deal with 404s itself
router.get('/view/:layout/:secret', (req, res) => {
	const layout = layouts[req.params.layout];

	if (!layout) {
		res.status(404).send('Not found');
		return;
	}

	res.sendFile(
		path.join(path.resolve(), `public/views/${layout.type}/${layout.file}.html`)
	);
});

router.get('/replay/:layout/:gamedef', (req, res) => {
	const layout = layouts[req.params.layout];

	if (!layout) {
		res.status(404).send('Not found');
		return;
	}

	res.sendFile(
		path.join(path.resolve(), `public/views/${layout.type}/${layout.file}.html`)
	);
});

if (process.env.IS_PUBLIC_SERVER != '1') {
	// prep a route to set up the global qual mode, which will be used to record qual results
	// TODO: how to set add authentication to the endpoint
	router.get('/system/qual/:name/start', (req, res) => {
		global.__ntc_event_name = req.params.name;
		res.sendStatus(200);
	});

	router.get('/system/qual/:name/stop', (req, res) => {
		if (global.__ntc_event_name === req.params.name) {
			global.__ntc_event_name = '';
			delete global.__ntc_event_name;
			res.sendStatus(200);
		} else {
			res.status(404).json({ msg: `Event ${req.params.name} not started` });
		}
	});

	router.get('/system/qual/:name/results', async (req, res) => {
		// TODO: implement 60s cache for the results
		const max_value = /^[1-9]\d+$/.test(req.query.max_value)
			? parseInt(req.query.max_value, 10)
			: 999999; // standard maxout

		res.json(await ScoreDAO.getQualResults(req.params.name, max_value));
	});
}

export default router;
