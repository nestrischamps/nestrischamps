import express from 'express';
import { ulid } from 'ulid';
import got from 'got';

import middlewares from '../modules/middlewares.js';

import { OAuth2Client as GoogleOAuth2Client } from 'google-auth-library';
import config from '../modules/config.js';

const googleOAuth2Client = new GoogleOAuth2Client(
	config.get('auth.google.client_id'),
	config.get('auth.google.client_secret'),
	config.get('auth.google.redirect_url')
);

const TWITCH_LOGIN_BASE_URI = 'https://id.twitch.tv/oauth2/authorize?';
const TWITCH_LOGIN_QS = new URLSearchParams({
	client_id: config.get('auth.twitch.client_id'),
	scope: 'user:read:email chat:read',
	response_type: 'code',
	force_verify: true,
});

const DISCORD_LOGIN_BASE_URI = 'https://discord.com/oauth2/authorize?';
const DISCORD_LOGIN_QS = new URLSearchParams({
	client_id: config.get('auth.discord.client_id'),
	scope: 'identify email',
	response_type: 'code',
	force_verify: true,
});

import UserDAO from '../daos/UserDAO.js';

const router = express.Router();

function getTwitchAuthUrl(req) {
	TWITCH_LOGIN_QS.set(
		'redirect_uri',
		`${config.get('server.is_public') ? 'https' : req.protocol}://${req.get(
			'host'
		)}/auth/twitch/callback`
	);

	const qs = TWITCH_LOGIN_QS.toString();

	return `${TWITCH_LOGIN_BASE_URI}${qs}`;
}

// replace your current getGoogleAuthUrl() with this version
function getGoogleAuthUrl(req) {
	const state = ulid();
	const nonce = ulid();

	// store for callback verification
	req.session.google_oauth_state = state;
	req.session.google_oauth_nonce = nonce;

	return googleOAuth2Client.generateAuthUrl({
		access_type: 'offline',
		// prompt: 'consent', // ensures refresh_token on first consent
		scope: ['openid', 'email', 'profile'],
		state,
		// nonce is a valid OIDC param supported by Google
		// TypeScript users: you may need a ts-ignore if your types are older
		nonce,
	});
}

function getDiscordAuthUrl(req) {
	DISCORD_LOGIN_QS.set(
		'redirect_uri',
		`${req.protocol}://${req.get('host')}/auth/discord/callback`
	);

	const qs = DISCORD_LOGIN_QS.toString();

	return `${DISCORD_LOGIN_BASE_URI}${qs}`;
}
if (config.get('server.is_public')) {
	router.get('/', (_req, res) => {
		res.render('login');
	});

	router.get('/login', (_req, res) => {
		res.render('login');
	});

	router.get('/twitch', (req, res) => {
		res.redirect(getTwitchAuthUrl(req));
	});

	router.get('/google', (req, res) => {
		res.redirect(getGoogleAuthUrl(req));
	});
	router.get('/discord', (req, res) => {
		res.redirect(getDiscordAuthUrl(req));
	});
} else {
	router.get('/', (_req, res) => {
		res.render('local_login');
	});

	router.get('/set_session_player/:player_id', async (req, res) => {
		const user = await UserDAO.getUserById(req.params.player_id);

		console.log(
			`Retrieved local user object from DB for ${user.id} (${user.login})`
		);

		req.session.user = {
			id: user.id,
			login: user.login,
			secret: user.secret,
			profile_image_url: user.profile_image_url,
			country_code: user.country_code,
		};

		req.session.save(() => {
			console.log('Stored session user as', req.session.user);

			if (req.session.auth_success_redirect) {
				res.redirect(req.session.auth_success_redirect);
			} else {
				res.render('intro');
			}
		});
	});
}

router.get('/twitch/callback', async (req, res) => {
	console.log(`Twitch callback received with code [${req.query.code}]`);

	if (!req.query.code) {
		res
			.status(400)
			.send(
				`Unable to authenticate [${req.query.error}]: ${req.query.error_description}`
			);
		return;
	}

	try {
		const { body: token } = await got.post(
			'https://id.twitch.tv/oauth2/token',
			{
				searchParams: {
					client_id: config.get('auth.twitch.client_id'),
					client_secret: config.get('auth.twitch.client_secret'),
					code: req.query.code,
					grant_type: 'authorization_code',
					redirect_uri: `${req.protocol}://${req.get(
						'host'
					)}/auth/twitch/callback`,
				},
				responseType: 'json',
			}
		);

		console.log(`Retrieved oauth token`);

		// must validate token to get user id
		const user_response = await got.get(
			'https://id.twitch.tv/oauth2/validate',
			{
				headers: {
					Authorization: `OAuth ${token.access_token}`,
				},
				responseType: 'json',
			}
		);

		const twitch_user_id = user_response.body.user_id;

		console.log(`Completed token validation for ${twitch_user_id}`);

		// finally can get user data from user id
		const user_data_response = await got.get(
			'https://api.twitch.tv/helix/users',
			{
				headers: {
					'Client-Id': config.get('auth.twitch.client_id'),
					'Authorization': `Bearer ${token.access_token}`,
				},
				searchParams: {
					id: twitch_user_id,
				},
				responseType: 'json',
			}
		);

		// console.log({ data: user_data_response.body.data });

		const user_object = user_data_response.body.data[0];

		console.log(
			`Retrieved user data for ${user_object.id} (${user_object.login})`
		);

		// augment use object with data we retrieve previously
		user_object.secret = ulid();

		// NEED more logic here to check BOTh the users and oauth users table sigh...
		const user = await UserDAO.createUser(user_object, {
			provider: 'twitch',
			current_user: req.session?.user,
			pending_linkage: req.session?.pending_linkage_expiry > Date.now(),
		});

		// pending linkage is single use
		if (req.session?.pending_linkage_expiry) {
			req.session.pending_linkage_expiry = null;
			delete req.session.pending_linkage_expiry;
		}

		console.log(
			`Retrieved user object from DB for user id ${user.id} via Twitch user (${twitch_user_id} - ${user_object.login})`
		);

		const augmented_twitch_token = {
			...token,
			id: user_object.id,
			login: user_object.login,
		};

		user.setTwitchToken(augmented_twitch_token);

		// TODO: modify when adding google auth
		req.session.token = {
			twitch: augmented_twitch_token,
		};

		req.session.user = {
			id: user.id,
			login: user.login,
			secret: user.secret,
			profile_image_url: user.profile_image_url,
		};

		req.session.save(() => {
			console.log('Stored session user as', req.session.user);
			res.redirect(req.session.auth_success_redirect || '/');
		});
	} catch (err) {
		console.error(`Error when processing Twitch callback`);
		console.error(err);
		res
			.status(500)
			.send(
				`An unexpected error occured with your Twich login: ${err.message}. Please try again later`
			);
	}
});

router.get('/google/callback', async (req, res) => {
	const { code, state } = req.query;

	// 1) CSRF protection: check state
	if (!state || state !== req.session.google_oauth_state) {
		return res.status(400).send('Invalid state');
	}

	if (!code) {
		return res.redirect('/');
	}

	if (code) {
		try {
			// 2) Exchange code for tokens
			const { tokens } = await googleOAuth2Client.getToken(code);
			googleOAuth2Client.setCredentials(tokens);

			// 3) Verify ID token, including nonce + get user info
			const ticket = await googleOAuth2Client.verifyIdToken({
				idToken: tokens.id_token,
				audience: config.get('auth.google.client_id'),
			});
			const payload = ticket.getPayload();

			// 4) Replay protection: check nonce from ID token
			if (!payload || payload.nonce !== req.session.google_oauth_nonce) {
				return res.status(400).send('Invalid nonce');
			}

			// clear state and nonce after successful checks
			req.session.google_oauth_state = undefined;
			req.session.google_oauth_nonce = undefined;

			// mimic twitch shape
			const login = ulid().toLowerCase();
			const user_object = {
				id: payload.sub,
				secret: ulid(),
				type: '',
				description: '',
				login,
				display_name: login.slice(-10).toUpperCase(),
				email: payload.email,
				profile_image_url: payload.picture,
			};

			// NEED more logic here to check BOTh the users and oauth users table sigh...
			const user = await UserDAO.createUser(user_object, {
				provider: 'google',
				current_user: req.session?.user,
				pending_linkage: req.session?.pending_linkage_expiry > Date.now(),
			});

			// pending linkage is single use
			if (req.session?.pending_linkage_expiry) {
				req.session.pending_linkage_expiry = null;
				delete req.session.pending_linkage_expiry;
			}

			user.setGoogleToken(tokens);

			// Save the token to the session
			req.session.token = {
				google: tokens,
			};

			req.session.user = {
				id: user.id,
				login: user.login,
				secret: user.secret,
				profile_image_url: user.profile_image_url,
			};

			req.session.save(() => {
				console.log('Stored session user as', req.session.user);
				res.redirect(req.session.auth_success_redirect || '/');
			});
		} catch (error) {
			console.error('Error during authentication:', error);
			res.redirect('/');
		}
	} else {
		res.redirect('/');
	}
});

router.get('/discord/callback', async (req, res) => {
	console.log(`Discord callback received with code [${req.query.code}]`);

	if (!req.query.code) {
		res
			.status(400)
			.send(
				`Unable to authenticate [${req.query.error}]: ${req.query.error_description}`
			);
		return;
	}

	console.log(`Discord get access token`);

	try {
		const { body: token } = await got.post(
			'https://discord.com/api/oauth2/token',
			{
				headers: {
					'Authorization':
						'Basic ' +
						Buffer.from(
							`${config.get('auth.discord.client_id')}:${config.get('auth.discord.client_secret')}`
						).toString('base64'),
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				form: {
					code: req.query.code,
					grant_type: 'authorization_code',
					redirect_uri: `${req.protocol}://${req.get(
						'host'
					)}/auth/discord/callback`,
				},
				responseType: 'json',
			}
		);

		console.log(`Retrieved oauth token`, token);

		// finally can get user data from user id
		const { body: user_object } = await got.get(
			'https://discord.com/api/users/@me',
			{
				headers: {
					authorization: `${token.token_type} ${token.access_token}`,
				},
				responseType: 'json',
			}
		);

		console.log({ data: user_object });

		// transform discord response into twitch-like user object
		user_object.profile_image_url = `https://cdn.discordapp.com/avatars/${user_object.id}/${user_object.avatar}?size=512`;
		user_object.login = user_object.username;
		user_object.secret = ulid();
		user_object.type = '';
		user_object.display_name = user_object.global_name;

		// NEED more logic here to check BOTh the users and oauth users table sigh...
		const user = await UserDAO.createUser(user_object, {
			provider: 'discord',
			current_user: req.session?.user,
			pending_linkage: req.session?.pending_linkage_expiry > Date.now(),
		});

		// pending linkage is single use
		if (req.session?.pending_linkage_expiry) {
			req.session.pending_linkage_expiry = null;
			delete req.session.pending_linkage_expiry;
		}

		console.log(
			`Retrieved user object from DB for ${user_object.id} (${user_object.login})`
		);

		user.setDiscordToken(token);

		// TODO: modify when adding google auth
		req.session.token = {
			discord: token,
		};

		req.session.user = {
			id: user.id,
			login: user.login,
			secret: user.secret,
			profile_image_url: user.profile_image_url,
		};

		req.session.save(() => {
			console.log('Stored session user as', req.session.user);
			res.redirect(req.session.auth_success_redirect || '/');
		});
	} catch (err) {
		console.error(`Error when processing Discord callback`);
		console.error(err);
		res
			.status(500)
			.send(
				`An unexpected error occured with your Discord login: ${err.message}. Please try again later.`
			);
	}
});

router.get('/link/twitch', middlewares.assertSession, async (req, res) => {
	req.session.auth_success_redirect = '/auth/link';
	req.session.pending_linkage_expiry = Date.now() + 120000; // 2 minute max to complete linkage
	res.redirect(getTwitchAuthUrl(req));
});

router.get('/link/google', middlewares.assertSession, async (req, res) => {
	req.session.auth_success_redirect = '/auth/link';
	req.session.pending_linkage_expiry = Date.now() + 120000; // 2 minute max to complete linkage
	res.redirect(getGoogleAuthUrl(req));
});

router.get('/link/discord', middlewares.assertSession, async (req, res) => {
	req.session.auth_success_redirect = '/auth/link';
	req.session.pending_linkage_expiry = Date.now() + 120000; // 2 minute max to complete linkage
	res.redirect(getDiscordAuthUrl(req));
});

router.get('/link', middlewares.assertSession, async (req, res) => {
	const identities = await UserDAO.getIdentities(req.session.user.id);
	const providers = identities.reduce((acc, identity) => {
		acc[identity.provider] |= 0;
		acc[identity.provider] += 1;
		return acc;
	}, {});
	res.render('link', {
		providers,
		identities,
	});
});

router.get(
	'/unlink/:identity_id',
	middlewares.assertSession,
	async (req, res) => {
		// sanity check before deleting
		const identities = await UserDAO.getIdentities(req.session.user.id);
		const identity = identities.find(
			identity => identity.id === req.params.identity_id
		);

		// we only accept to remove an identity if it's not the last one
		if (identity && identities.length > 1) {
			const removed = await UserDAO.removeIdentity(
				req.session.user.id,
				identity.id
			);

			const new_token = { ...req.session.token };

			delete new_token[removed.provider]; // we clear the identity tokens from the session

			req.session.token = new_token;
		}

		res.redirect('/auth/link');
	}
);

export default router;
