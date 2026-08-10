import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import ScoreDAO from '../daos/ScoreDAO.js';
import { setScoreCompetition } from '../domains/ScoreService.js';

describe('ScoreService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockUser = { id: 42, login: 'testplayer' };

	it('should set competition mode to true for score when boolean true is passed', async () => {
		const spy = jest.spyOn(ScoreDAO, 'updateScore').mockResolvedValue(true);
		const res = await setScoreCompetition(mockUser, 101, true);
		expect(spy).toHaveBeenCalledWith(mockUser, 101, true);
		expect(res).toBe(true);
	});

	it('should set competition mode to false for score when boolean false is passed', async () => {
		const spy = jest.spyOn(ScoreDAO, 'updateScore').mockResolvedValue(true);
		const res = await setScoreCompetition(mockUser, '101', false);
		expect(spy).toHaveBeenCalledWith(mockUser, '101', false);
		expect(res).toBe(true);
	});
});
