import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import ScoreQuery from '../domains/ScoreQuery.js';
import ScoreDAO from '../daos/ScoreDAO.js';
import config from '../modules/config.js';

describe('ScoreQuery Domain', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	describe('parseOptions', () => {
		it('should fallback to default options when given empty query', () => {
			const options = ScoreQuery.parseOptions({});

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
			const options = ScoreQuery.parseOptions({
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
			const small = ScoreQuery.parseOptions({ page_size: '10' });
			expect(small.page_size).toBe(config.get('server.max_page'));

			const large = ScoreQuery.parseOptions({ page_size: '99999' });
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
			const result = await ScoreQuery.fetchPage(
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
