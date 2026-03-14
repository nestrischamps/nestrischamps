import convict from 'convict';

const config = convict({
	db: {
		url: {
			doc: 'Database connection string URL',
			format: String,
			default: '',
			env: 'DATABASE_URL',
		},
	},
	auth: {
		discord: {
			client_id: {
				doc: 'Discord OAuth Client ID',
				format: String,
				default: '',
				env: 'DISCORD_CLIENT_ID',
			},
			client_secret: {
				doc: 'Discord OAuth Client Secret',
				format: String,
				default: '',
				env: 'DISCORD_CLIENT_SECRET',
			},
		},
		google: {
			client_id: {
				doc: 'Google OAuth Client ID',
				format: String,
				default: '',
				env: 'GOOGLE_AUTH_CLIENT_ID',
			},
			client_secret: {
				doc: 'Google OAuth Client Secret',
				format: String,
				default: '',
				env: 'GOOGLE_AUTH_CLIENT_SECRET',
			},
			redirect_url: {
				doc: 'Google OAuth Redirect URL',
				format: String,
				default: '',
				env: 'GOOGLE_AUTH_REDIRECT_URL',
			},
		},
		twitch: {
			client_id: {
				doc: 'Twitch OAuth Client ID',
				format: String,
				default: '',
				env: 'TWITCH_CLIENT_ID',
			},
			client_secret: {
				doc: 'Twitch OAuth Client Secret',
				format: String,
				default: '',
				env: 'TWITCH_CLIENT_SECRET',
			},
			chat_enabled: {
				doc: 'Enable Twitch Chat integration',
				format: Boolean,
				default: false,
				env: 'TWITCH_CHAT_ENABLED',
			},
		},
	},
	server: {
		port: {
			doc: 'The port to bind.',
			format: 'port',
			default: 5000,
			env: 'PORT',
		},
		is_public: {
			doc: 'Flag indicating if the server is running publicly.',
			format: Boolean,
			default: false,
			env: 'IS_PUBLIC_SERVER',
		},
		session_secret: {
			doc: 'Secret used for cookie session encryption.',
			format: String,
			default: '',
			env: 'SESSION_SECRET',
		},
		tls_cert: {
			doc: 'Path to TLS Certificate',
			format: String,
			default: '',
			env: 'TLS_CERT',
		},
		tls_key: {
			doc: 'Path to TLS Key',
			format: String,
			default: '',
			env: 'TLS_KEY',
		},
		in_script: {
			doc: 'Flag indicating if running from a script',
			format: Boolean,
			default: false,
			env: 'IN_SCRIPT',
		},
	},
	game: {
		save_frames: {
			doc: 'Whether to save game frames or not (0 to disable)',
			format: Boolean, // Note: FF_SAVE_GAME_FRAMES !== '0' implies if it is '0', it's false, else true
			default: true,
			env: 'FF_SAVE_GAME_FRAMES',
		},
		frames_bucket: {
			doc: 'S3 bucket for game frames',
			format: String,
			default: '',
			env: 'GAME_FRAMES_BUCKET',
		},
		frames_region: {
			doc: 'S3 region for game frames',
			format: String,
			default: '',
			env: 'GAME_FRAMES_REGION',
		},
		frames_baseurl: {
			doc: 'Base URL for game frames',
			format: String,
			default: '',
			env: 'GAME_FRAMES_BASEURL',
		},
	},
	local_users: {
		allow_import: {
			doc: 'Allow importing local users from CSV',
			format: Boolean,
			default: false,
			env: 'LOCAL_USERS_ALLOW_IMPORT',
		},
		csv_url: {
			doc: 'URL of the CSV to import users from',
			format: String,
			default: '',
			env: 'LOCAL_USERS_CSV_URL',
		},
		refresh_interval: {
			doc: 'Interval (in seconds) to refresh local users',
			format: Number,
			default: 0,
			env: 'LOCAL_USERS_REFRESH',
		},
	},
	expressturn: {
		secret_key: {
			doc: 'Secret key for Expressturn',
			format: String,
			default: '',
			env: 'EXPRESSTURN_SECRET_KEY',
		},
		username: {
			doc: 'Username for Expressturn',
			format: String,
			default: '',
			env: 'EXPRESSTURN_USERNAME',
		},
	},
});

config.validate({ allowed: 'strict' });

export default config;
