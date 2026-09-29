import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Pool } from 'pg';
import { config, isGoogleReady, isSlackReady } from './config.js';
import { db, initializeDatabase } from './db.js';
import { emailQueue, redis } from './queue.js';
import { authRouter } from './auth.js';
import { emailsRouter } from './emails.js';

const app = express();
const PgSession = connectPgSimple(session);
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(session({ store: new PgSession({ pool: db as unknown as Pool, createTableIfMissing: true }),
  name: 'reachinbox.sid', secret: config.sessionSecret, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 },
}));
app.use(passport.initialize());
app.use(passport.session());
app.use('/auth', authRouter);
app.use('/api/emails', emailsRouter);
app.get('/api/status', (_req, res) => res.json({ ok: true, googleLogin: isGoogleReady, slackOAuth: isSlackReady }));

const boardAdapter = new ExpressAdapter();
boardAdapter.setBasePath('/admin/queues');
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter: boardAdapter });
app.use('/admin/queues', (req, res, next) => req.isAuthenticated?.() ? next() : res.sendStatus(401), boardAdapter.getRouter());
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'Something went wrong while handling that request. Please try again.' });
});

if (process.env.NODE_ENV === 'production') {
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

async function start() {
  if (process.env.NODE_ENV === 'production' && (config.sessionSecret === 'local-only-change-me' || config.sessionSecret.length < 32)) {
    throw new Error('Set a random SESSION_SECRET of at least 32 characters before production.');
  }
  await initializeDatabase();
  const server = app.listen(config.port, () => console.log(`ReachInbox API listening on http://localhost:${config.port}`));
  const shutdown = async () => {
    server.close();
    await emailQueue.close(); await redis.quit(); await db.end();
  };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}

start().catch(error => { console.error('Could not start ReachInbox API:', error); process.exit(1); });
