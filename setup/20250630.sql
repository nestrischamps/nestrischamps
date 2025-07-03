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




