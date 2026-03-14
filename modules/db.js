import pg from 'pg';
import config from './config.js';

let pool;

const isPublicServer = config.get('server.is_public');

console.log(`DB initialization`, {
	IS_PUBLIC_SERVER: isPublicServer,
});

pool = new pg.Pool({
	connectionString: config.get('db.url'),
	ssl: {
		rejectUnauthorized: false, // isPublicServer,
	},
});

// the pool will emit an error on behalf of any idle clients
// it contains if a backend error or network partition happens
pool.on('error', err => {
	console.error('DB: Unexpected error on idle client', err);
});

export default pool;
