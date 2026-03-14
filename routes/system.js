import express from 'express';
import ScoreDAO from '../daos/ScoreDAO.js';
import { importUsers } from '../modules/LocalUsers.js';
import config from '../modules/config.js';

const router = express.Router();

if (!config.get('server.is_public')) {
	router.get('/import-local-users', async (req, res) => {
		const data = await importUsers({
			clearOldUsers: req.query.clear === '1',
		});

		res.json(data);
	});

	// prep a route to set up the global qual mode, which will be used to record qual results
	// TODO: how to set add authentication to the endpoint
	router.get('/qual/:name/start', (req, res) => {
		global.__ntc_event_name = req.params.name;
		res.sendStatus(200);
	});

	router.get('/qual/:name/stop', (req, res) => {
		if (global.__ntc_event_name === req.params.name) {
			global.__ntc_event_name = '';
			delete global.__ntc_event_name;
			res.sendStatus(200);
		} else {
			res.status(404).json({ msg: `Event ${req.params.name} not started` });
		}
	});

	router.get('/qual/:name/results', async (req, res) => {
		// TODO: implement 60s cache for the results
		const max_value = /^[1-9]\d+$/.test(req.query.max_value)
			? parseInt(req.query.max_value, 10)
			: 999999; // standard maxout

		res.json(await ScoreDAO.getQualResults(req.params.name, max_value));
	});
}

export default router;
