import config from '../modules/config.js';
import ScoreDAO from '../daos/ScoreDAO.js';

const ALLOWED_ORDER_FIELDS = [
	'datetime',
	'lines',
	'score',
	'tetris_rate',
	'num_droughts',
	'max_drought',
];
const ALLOWED_ORDER_DIRS = ['desc', 'asc'];

class ScoreQuery {
	parseOptions(query = {}) {
		let sort_field = 'datetime';
		if (ALLOWED_ORDER_FIELDS.includes(query.sort_field)) {
			sort_field = query.sort_field;
		}

		let sort_order = 'desc';
		if (ALLOWED_ORDER_DIRS.includes(query.sort_order)) {
			sort_order = query.sort_order;
		}

		const max_page_size = config.get('server.max_page') || 100;
		let page_size = max_page_size;

		if (/^\d+$/.test(query.page_size)) {
			const tentative_page_size = parseInt(query.page_size, 10);
			if (tentative_page_size >= 20 && tentative_page_size <= max_page_size) {
				page_size = tentative_page_size;
			}
		}

		let page_idx = 0;
		if (/^\d+$/.test(query.page_idx)) {
			page_idx = parseInt(query.page_idx, 10);
		}

		let level = null;
		if (
			query.level !== null &&
			query.level !== undefined &&
			/^[12]?\d$/.test(String(query.level))
		) {
			level = parseInt(query.level, 10);
		}

		let competition = null;
		if (typeof query.competition === 'boolean') {
			competition = query.competition;
		} else if (/^(true|1)$/i.test(query.competition)) {
			competition = true;
		} else if (/^(false|0)$/i.test(query.competition)) {
			competition = false;
		}

		return {
			sort_field,
			sort_order,
			page_size,
			page_idx,
			level,
			competition,
		};
	}

	async fetchPage(user, queryOptions = {}, req = null) {
		const options = this.parseOptions(queryOptions);

		const total_scores = await ScoreDAO.getNumberOfScores(user, options);
		const num_pages = Math.ceil(total_scores / options.page_size) || 1;

		options.page_idx = Math.max(0, Math.min(options.page_idx, num_pages - 1));

		const scores = await ScoreDAO.getScorePage(user, options);

		scores.forEach(score => {
			if (score.frame_file) {
				if (config.get('game.frames_bucket')) {
					const base_url = `https://${config.get('game.frames_bucket')}.s3-${config.get('game.frames_region')}.amazonaws.com/`;
					score.frame_url = `${base_url}${score.frame_file}`;
				} else if (req && req.protocol && req.headers && req.headers.host) {
					score.frame_url = `${req.protocol}://${req.headers.host}/api/files/${score.frame_file}`;
				} else {
					score.frame_url = `/api/files/${score.frame_file}`;
				}
			}
		});

		return {
			scores,
			total_scores,
			num_pages,
			options,
		};
	}
}

export default new ScoreQuery();
