import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import ScoreDAO from '../daos/ScoreDAO.js';
import ScoreService, { setScoreCompetition } from '../domains/ScoreService.js';
import config from '../modules/config.js';

describe('ScoreService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	describe('setScoreCompetition', () => {
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

	describe('parseOptions', () => {
		it('should fallback to default options when given empty query', () => {
			const options = ScoreService.parseOptions({});

			expect(options).toEqual({
				sort_field: 'datetime',
				sort_order: 'desc',
				page_size: config.get('server.max_page'),
				page_idx: 0,
				level: null,
				competition: null,
			});
		});

		it('should validate and parse sort_field, sort_order, page_size, page_idx, level, and competition', () => {
			const options = ScoreService.parseOptions({
				sort_field: 'score',
				sort_order: 'asc',
				page_size: '50',
				page_idx: '2',
				level: '18',
				competition: 'true',
			});

			expect(options).toEqual({
				sort_field: 'score',
				sort_order: 'asc',
				page_size: 50,
				page_idx: 2,
				level: 18,
				competition: true,
			});
		});

		it('should enforce min page_size of 20 and max page_size of server.max_page', () => {
			const small = ScoreService.parseOptions({ page_size: '10' });
			expect(small.page_size).toBe(config.get('server.max_page'));

			const large = ScoreService.parseOptions({ page_size: '99999' });
			expect(large.page_size).toBe(config.get('server.max_page'));
		});
	});

	describe('fetchPage', () => {
		const mockUser = { id: 10, login: 'player1' };

		it('should count scores, fetch page, clamp page_idx, and add frame_url', async () => {
			jest.spyOn(ScoreDAO, 'getNumberOfScores').mockResolvedValue(250);
			jest
				.spyOn(ScoreDAO, 'getScorePage')
				.mockResolvedValue([{ id: 1, frame_file: '001.ngf' }]);

			const req = { protocol: 'https', headers: { host: 'nestrischamps.io' } };
			const result = await ScoreService.fetchPage(
				mockUser,
				{ page_idx: '999' },
				req
			);

			expect(result.total_scores).toBe(250);
			expect(result.num_pages).toBe(3); // 250 / 100 => 3 pages
			expect(result.options.page_idx).toBe(2); // clamped 999 -> index 2
			expect(result.scores[0].frame_url).toBe(
				'https://nestrischamps.io/api/files/001.ngf'
			);
		});
	});
});
