CREATE TYPE play_style AS ENUM ('das', 'tap', 'roll', 'hybrid');
CREATE TYPE controller_type AS ENUM ('nes', 'goofy-foot', 'hyperkin-cadet', 'keyboard', 'other');
CREATE TYPE identity_provider AS ENUM ('google', 'twitch', 'github', 'discord', 'facebook', 'slack');

CREATE TABLE users (
	id BIGSERIAL PRIMARY KEY,
	login VARCHAR ( 40 ) UNIQUE NOT NULL,
	secret VARCHAR ( 36 ) UNIQUE NOT NULL,

	type VARCHAR ( 128 ),
	description TEXT,
	display_name VARCHAR ( 255 ),
	full_name VARCHAR ( 255 ),
	pronouns VARCHAR ( 128 ),
	profile_image_url VARCHAR ( 255 ),

	dob date,
	country_code VARCHAR( 2 ),
	city VARCHAR( 100 ),
	timezone TEXT NOT NULL CHECK (now() AT TIME ZONE timezone IS NOT NULL) DEFAULT 'UTC',
	interests VARCHAR ( 300 ) default '',

	style play_style default 'das',
	controller controller_type default 'nes',
	rival VARCHAR ( 128 ) default '',
	rival_reason VARCHAR ( 300 ) default '',

	elo_rank INTEGER NOT NULL DEFAULT 0,
	elo_rating DOUBLE PRECISION NOT NULL DEFAULT 0,

	created_at timestamptz NOT NULL DEFAULT NOW(),
	last_login_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER SEQUENCE users_id_seq RESTART WITH 1000;

CREATE TABLE scores (
	id BIGSERIAL PRIMARY KEY,
	datetime timestamptz NOT NULL,
	player_id BIGINT NOT NULL,
	session INTEGER DEFAULT 1,
	start_level SMALLINT,
	end_level SMALLINT,
	score INTEGER,
	lines SMALLINT,
	tetris_rate DOUBLE PRECISION,
	num_droughts SMALLINT,
	max_drought SMALLINT,
	das_avg DOUBLE PRECISION,
	duration INTEGER DEFAULT 0,
	clears VARCHAR(600) DEFAULT '',
	pieces VARCHAR(2400) DEFAULT '',
	transition INTEGER DEFAULT NULL,
	num_frames INTEGER DEFAULT 0,
	frame_file VARCHAR(256) DEFAULT '',
	competition BOOLEAN default false,
	manual BOOLEAN default false,

	CONSTRAINT fk_player
		FOREIGN KEY(player_id)
			REFERENCES users(id)
				ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IDX_scores_manual_scores on scores (player_id, start_level, competition) where manual;
CREATE INDEX IDX_scores_player_level_competition ON scores (player_id, start_level, competition);
CREATE INDEX IDX_scores_player_score ON scores (player_id, score);
CREATE INDEX IDX_scores_player_session ON scores (player_id, session);
CREATE INDEX IDX_scores_player_level ON scores (player_id, start_level);
CREATE INDEX IDX_scores_player_datetime ON scores (player_id, datetime);
CREATE INDEX IDX_scores_datetime ON scores (datetime);

create table qual_scores (
	datetime timestamptz NOT NULL DEFAULT NOW(),
	event VARCHAR ( 255 ) NOT NULL,

	player_id BIGINT NOT NULL,
	score_id BIGINT NOT NULL,

	on_behalf_of_user_id BIGINT NOT NULL,
	display_name VARCHAR ( 255 ),

	CONSTRAINT fk_player
		FOREIGN KEY(player_id)
			REFERENCES users(id)
				ON DELETE CASCADE ON UPDATE CASCADE,

	CONSTRAINT fk_score
		FOREIGN KEY(score_id)
			REFERENCES scores(id)
				ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IDX_qual_scores_event on qual_scores (event);

CREATE TABLE user_identities (
    id BIGSERIAL PRIMARY KEY,

    provider identity_provider NOT NULL,
    provider_user_id VARCHAR ( 36 ) NOT NULL,

    user_id BIGINT,
    login VARCHAR(40) DEFAULT NULL,
    email VARCHAR ( 255 ),

	created_at timestamptz NOT NULL DEFAULT NOW(),
	updated_at timestamptz NOT NULL DEFAULT NOW(),
    last_login_at timestamptz NOT NULL DEFAULT NOW(),

    access_token varchar( 128 ),
    refresh_token varchar( 128 ),

	CONSTRAINT fk_user
		FOREIGN KEY(user_id)
			REFERENCES users(id)
            ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IDX_user_identity on user_identities (provider, provider_user_id);
CREATE UNIQUE INDEX IDX_user_identity_login on user_identities (provider, login);
CREATE INDEX IDX_user_identity_email on user_identities (email);

CREATE TABLE user_emails (
    user_id BIGINT NOT NULL,
    email VARCHAR ( 255 ) NOT NULL,

	CONSTRAINT fk_user_emails
		FOREIGN KEY(user_id)
			REFERENCES users(id)
            ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IDX_user_emails on user_emails (user_id, email);
CREATE INDEX IDX_user_emails_id on user_emails (user_id);
CREATE INDEX IDX_user_emails_email on user_emails (email);

CREATE TABLE sessions (
	sid varchar NOT NULL COLLATE "default",
	sess json NOT NULL,
	expire timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE sessions ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IDX_session_expire ON sessions (expire);


INSERT INTO users
(id, login, secret, type, description, display_name, profile_image_url, dob, country_code, city, interests)
VALUES
(1,  'player1',  'PLAYER1',  '', '', 'Player 1',  '', NOW(), '', '', ''),
(2,  'player2',  'PLAYER2',  '', '', 'Player 2',  '', NOW(), '', '', ''),
(3,  'player3',  'PLAYER3',  '', '', 'Player 3',  '', NOW(), '', '', ''),
(4,  'player4',  'PLAYER4',  '', '', 'Player 4',  '', NOW(), '', '', ''),
(5,  'player5',  'PLAYER5',  '', '', 'Player 5',  '', NOW(), '', '', ''),
(6,  'player6',  'PLAYER6',  '', '', 'Player 6',  '', NOW(), '', '', ''),
(7,  'player7',  'PLAYER7',  '', '', 'Player 7',  '', NOW(), '', '', ''),
(8,  'player8',  'PLAYER8',  '', '', 'Player 8',  '', NOW(), '', '', ''),
(9,  'player9',  'PLAYER9',  '', '', 'Player 9',  '', NOW(), '', '', ''),
(10, 'player10', 'PLAYER10', '', '', 'Player 10', '', NOW(), '', '', ''),
(11, 'player11', 'PLAYER11', '', '', 'Player 11', '', NOW(), '', '', ''),
(12, 'player12', 'PLAYER12', '', '', 'Player 12', '', NOW(), '', '', ''),
(13, 'player13', 'PLAYER13', '', '', 'Player 13', '', NOW(), '', '', ''),
(14, 'player14', 'PLAYER14', '', '', 'Player 14', '', NOW(), '', '', ''),
(15, 'player15', 'PLAYER15', '', '', 'Player 15', '', NOW(), '', '', ''),
(16, 'player16', 'PLAYER16', '', '', 'Player 16', '', NOW(), '', '', ''),
(17, 'player17', 'PLAYER17', '', '', 'Player 17', '', NOW(), '', '', ''),
(18, 'player18', 'PLAYER18', '', '', 'Player 18', '', NOW(), '', '', ''),
(19, 'player19', 'PLAYER19', '', '', 'Player 19', '', NOW(), '', '', ''),
(20, 'player20', 'PLAYER20', '', '', 'Player 20', '', NOW(), '', '', ''),
(21, 'player21', 'PLAYER21', '', '', 'Player 21', '', NOW(), '', '', ''),
(22, 'player22', 'PLAYER22', '', '', 'Player 22', '', NOW(), '', '', ''),
(23, 'player23', 'PLAYER23', '', '', 'Player 23', '', NOW(), '', '', ''),
(24, 'player24', 'PLAYER24', '', '', 'Player 24', '', NOW(), '', '', ''),
(25, 'player25', 'PLAYER25', '', '', 'Player 25', '', NOW(), '', '', ''),
(26, 'player26', 'PLAYER26', '', '', 'Player 26', '', NOW(), '', '', ''),
(27, 'player27', 'PLAYER27', '', '', 'Player 27', '', NOW(), '', '', ''),
(28, 'player28', 'PLAYER28', '', '', 'Player 28', '', NOW(), '', '', ''),
(29, 'player29', 'PLAYER29', '', '', 'Player 29', '', NOW(), '', '', ''),
(30, 'player30', 'PLAYER30', '', '', 'Player 30', '', NOW(), '', '', ''),
(31, 'player31', 'PLAYER31', '', '', 'Player 31', '', NOW(), '', '', ''),
(32, 'player32', 'PLAYER32', '', '', 'Player 32', '', NOW(), '', '', '');
