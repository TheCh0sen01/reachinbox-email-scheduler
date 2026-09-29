import crypto from 'node:crypto';
import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { db } from './db.js';
import { config, isGoogleReady, isSlackReady } from './config.js';
import { encryptSecret } from './crypto.js';

export type AppUser = { id: string; email: string; name: string; avatar: string | null };
declare global { namespace Express { interface User extends AppUser {} } }

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id: string, done) => {
  try {
    const result = await db.query('SELECT id, email, name, avatar FROM users WHERE id = $1', [id]);
    done(null, result.rows[0] ?? false);
  } catch (error) { done(error); }
});

if (isGoogleReady) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL: process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:4000/auth/google/callback',
    scope: ['profile', 'email'],
  }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(new Error('Google did not share an email address.'));
      const user = await db.query(`INSERT INTO users (id, email, name, avatar) VALUES ($1,$2,$3,$4)
        ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name, avatar=EXCLUDED.avatar
        RETURNING id, email, name, avatar`, [profile.id, email, profile.displayName || email, profile.photos?.[0]?.value ?? null]);
      return done(null, user.rows[0]);
    } catch (error) { return done(error as Error); }
  }));
}

export const authRouter = express.Router();
authRouter.get('/google', (req, res, next) => {
  if (!isGoogleReady) return res.status(503).send('Google OAuth is not configured. Add Google OAuth credentials to .env.');
  const state = crypto.randomBytes(24).toString('hex');
  req.session.googleState = state;
  passport.authenticate('google', { scope: ['profile', 'email'], state })(req, res, next);
});
authRouter.get('/google/callback', (req, res, next) => {
  if (!req.query.state || req.query.state !== req.session.googleState) return res.status(400).send('Invalid Google OAuth state.');
  delete req.session.googleState;
  passport.authenticate('google', { failureRedirect: `${config.appUrl}/?login=failed` })(req, res, next);
}, (_req, res) => res.redirect(config.appUrl));
authRouter.get('/me', (req, res) => res.json({ user: req.user ?? null, googleReady: isGoogleReady }));
authRouter.get('/integrations', async (req, res, next) => {
  if (!req.isAuthenticated?.()) return res.sendStatus(401);
  try {
    const result = await db.query('SELECT slack_team_name FROM users WHERE id=$1', [req.user!.id]);
    res.json({ googleReady: isGoogleReady, slackReady: isSlackReady, slackTeam: result.rows[0]?.slack_team_name ?? null,
      senders: config.senders.map(({ id, name, user }) => ({ id, name, email: user })) });
  } catch (error) { next(error); }
});
authRouter.post('/logout', (req, res, next) => req.logout(error => {
  if (error) return next(error);
  req.session.destroy(() => res.clearCookie('reachinbox.sid').json({ ok: true }));
}));

authRouter.get('/slack', async (req, res) => {
  if (!req.isAuthenticated?.()) return res.sendStatus(401);
  if (!isSlackReady) return res.status(503).send('Slack OAuth is not configured. Add Slack OAuth credentials to .env.');
  if (!config.tokenEncryptionKey) return res.status(503).send('Set TOKEN_ENCRYPTION_KEY before connecting Slack.');
  const state = crypto.randomBytes(24).toString('hex');
  req.session.slackState = state;
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID!, scope: 'chat:write,im:write', state,
    redirect_uri: process.env.SLACK_CALLBACK_URL ?? 'http://localhost:4000/auth/slack/callback',
  });
  res.redirect(`https://slack.com/oauth/v2/authorize?${params}`);
});

authRouter.get('/slack/callback', async (req, res, next) => {
  try {
    if (!req.isAuthenticated?.()) return res.sendStatus(401);
    if (!req.query.state || req.query.state !== req.session.slackState) return res.status(400).send('Invalid Slack OAuth state.');
    delete req.session.slackState;
    if (typeof req.query.code !== 'string') return res.status(400).send('Slack did not return an authorization code.');
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.SLACK_CLIENT_ID!, client_secret: process.env.SLACK_CLIENT_SECRET!, code: req.query.code,
        redirect_uri: process.env.SLACK_CALLBACK_URL ?? 'http://localhost:4000/auth/slack/callback' }),
    });
    const data = await tokenResponse.json() as { ok: boolean; access_token?: string; team?: { id: string; name: string }; authed_user?: { id: string }; error?: string };
    if (!data.ok || !data.access_token || !data.team?.id || !data.authed_user?.id) throw new Error(data.error ?? 'Slack authorization failed.');
    await db.query('UPDATE users SET slack_access_token=$2, slack_team_id=$3, slack_team_name=$4, slack_user_id=$5 WHERE id=$1',
      [req.user!.id, encryptSecret(data.access_token), data.team.id, data.team.name, data.authed_user.id]);
    res.redirect(`${config.appUrl}/?slack=connected`);
  } catch (error) { next(error); }
});

authRouter.delete('/slack', async (req, res, next) => {
  try {
    if (!req.isAuthenticated?.()) return res.sendStatus(401);
    await db.query('UPDATE users SET slack_access_token=NULL, slack_team_id=NULL, slack_team_name=NULL, slack_user_id=NULL WHERE id=$1', [req.user!.id]);
    res.json({ connected: false });
  } catch (error) { next(error); }
});

declare module 'express-session' { interface SessionData { slackState?: string; googleState?: string } }
