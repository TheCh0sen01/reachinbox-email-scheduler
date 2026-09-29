import crypto from 'node:crypto';
import express from 'express';
import { db } from './db.js';
import { config } from './config.js';
import { emailQueue, scheduleEmail } from './queue.js';
import { findEmails, indexEmail } from './search.js';

export const emailsRouter = express.Router();
emailsRouter.use((req, res, next) => req.isAuthenticated?.() ? next() : res.sendStatus(401));

emailsRouter.get('/', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status && !['scheduled', 'sending', 'sent', 'failed'].includes(status)) return res.status(400).json({ error: 'Choose a valid email status.' });
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query) {
      try { return res.json({ emails: await findEmails(req.user!.id, query) }); }
      catch { /* Elasticsearch may be starting; PostgreSQL remains searchable. */ }
    }
    const values: unknown[] = [req.user!.id];
    const where = ['user_id = $1'];
    if (status) { values.push(status); where.push(`status = $${values.length}`); }
    if (query) { values.push(`%${query}%`); where.push(`(recipient ILIKE $${values.length} OR subject ILIKE $${values.length} OR body ILIKE $${values.length})`); }
    const result = await db.query(`SELECT id, recipient, subject, scheduled_at, sent_at, status, error, sender_id FROM emails WHERE ${where.join(' AND ')} ORDER BY scheduled_at ASC LIMIT 500`, values);
    res.json({ emails: result.rows });
  } catch (error) { next(error); }
});

emailsRouter.post('/schedule', async (req, res, next) => {
  const { subject, body, recipients, startAt, delaySeconds, hourlyLimit, senderId } = req.body as {
    subject?: string; body?: string; recipients?: string[]; startAt?: string;
    delaySeconds?: number; hourlyLimit?: number; senderId?: string;
  };
  const cleanRecipients = [...new Set((recipients ?? []).map(address => String(address).trim().toLowerCase()))];
  const addressPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const start = startAt ? new Date(startAt) : null;
  const gap = Number(delaySeconds);
  const limit = Number(hourlyLimit ?? config.hourlyLimit);
  if (!subject?.trim() || !body?.trim() || !cleanRecipients.length || cleanRecipients.length > 5000
    || cleanRecipients.some(address => !addressPattern.test(address)) || !start || Number.isNaN(start.getTime()) || start.getTime() < Date.now()
    || !Number.isFinite(gap) || gap < Math.ceil(config.minSendGapMs / 1000)
    || !Number.isInteger(limit) || limit < 1 || limit > 10000) {
    return res.status(400).json({ error: `Please check the message, recipient list, future start time, delay (at least ${Math.ceil(config.minSendGapMs / 1000)} seconds), and hourly limit.` });
  }
  const sender = config.senders.find(item => item.id === senderId) ?? config.senders[0];
  if (senderId && !sender) return res.status(400).json({ error: 'That sender is not configured.' });
  const selectedSender = sender ?? { id: 'default' };
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const scheduled: { id: string; scheduledAt: Date }[] = [];
    for (const [index, recipient] of cleanRecipients.entries()) {
      const id = crypto.randomUUID();
      const scheduledAt = new Date(start.getTime() + index * gap * 1000);
      const inserted = await client.query(`INSERT INTO emails (id,user_id,sender_id,recipient,subject,body,scheduled_at,hourly_limit)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id,recipient,subject,scheduled_at) DO NOTHING RETURNING id,scheduled_at`,
      [id, req.user!.id, selectedSender.id, recipient, subject.trim(), body.trim(), scheduledAt, limit]);
      if (inserted.rows[0]) scheduled.push({ id: inserted.rows[0].id as string, scheduledAt: inserted.rows[0].scheduled_at as Date });
    }
    await client.query('COMMIT');
    for (const email of scheduled) {
      await scheduleEmail(email);
      await indexEmail({ ...email, userId: req.user!.id, senderId: selectedSender.id,
        subject: subject.trim(), body: body.trim(), status: 'scheduled' });
    }
    const all = await db.query('SELECT id,recipient,subject,scheduled_at,status FROM emails WHERE user_id=$1 AND subject=$2 AND scheduled_at >= $3 ORDER BY scheduled_at LIMIT $4',
      [req.user!.id, subject.trim(), start, cleanRecipients.length]);
    res.status(201).json({ scheduled: scheduled.length, emails: all.rows });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally { client.release(); }
});

emailsRouter.get('/queue', async (_req, res, next) => {
  try {
    const [waiting, delayed, active, failed] = await Promise.all([
      emailQueue.getWaitingCount(), emailQueue.getDelayedCount(), emailQueue.getActiveCount(), emailQueue.getFailedCount(),
    ]);
    res.json({ waiting, delayed, active, failed, concurrency: config.concurrency });
  } catch (error) { next(error); }
});
