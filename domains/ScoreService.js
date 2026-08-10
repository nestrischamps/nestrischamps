import ScoreDAO from '../daos/ScoreDAO.js';

/**
 * Updates the competition flag for a score owned by a user.
 *
 * @param {Object} user - The authenticated user object
 * @param {string|number} scoreId - The ID of the score/game
 * @param {boolean} competition - Boolean flag indicating if competition mode is active
 * @returns {Promise<boolean>}
 */
export async function setScoreCompetition(user, scoreId, competition) {
	return await ScoreDAO.updateScore(user, scoreId, !!competition);
}

/**
 * Express handler for score competition toggle endpoint.
 * Works for both session-authenticated (req.session.user) and header-authenticated (req.user) requests.
 */
export async function handleUpdateScoreCompetition(req, res) {
	console.log(`Updating score ${req.params.id}`);

	if (!['0', '1'].includes(req.params.mode)) {
		res.status(400).send('Invalid value for competition mode');
		return;
	}

	const user = req.user || req.session?.user;

	try {
		await setScoreCompetition(user, req.params.id, req.params.mode === '1');
		res.json({ status: 'ok' });
	} catch (err) {
		console.error(err);
		res.status(500).send('Unable to update score');
	}
}
