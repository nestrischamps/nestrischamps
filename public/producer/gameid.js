let gameid;

export function getNextGameId() {
	let new_game_id = 0;

	// we want to minimize the risk of gameid being duplicated when the producer page refreshes
	if (gameid === undefined) {
		new_game_id = localStorage.getItem('gameid');

		if (new_game_id !== null) {
			new_game_id = parseInt(new_game_id) + 1; // could be NaN if local storage value is garbage (shouldn't happen, just being paranoid)
		}

		if (new_game_id === null || isNaN(new_game_id)) {
			new_game_id = Date.now() + Math.floor(Math.random() * (1 << 30));
		}
	} else {
		new_game_id = gameid + 1;
	}

	new_game_id %= 0xffff; // because gameid in binary frame format is 16 bits

	if (!new_game_id) new_game_id = 1; // never report gameid as 0, so we can always assume a valid gameid is truthy

	localStorage.setItem('gameid', new_game_id);

	return new_game_id;
}
