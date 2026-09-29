import { DelayedError, Worker, type Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { db } from './db.js';
import { config } from './config.js';
import { redis } from './queue.js';
import { reserveSenderSlot } from './rate-limit.js';
import { indexEmail } from './search.js';
import { decryptSecret } from './crypto.js';

type JobData = { emailId: string };
const smtp = nodemailer.createTransport({
  host: process.env.ETHEREAL_HOST ?? 'smtp.ethereal.email',
  port: Number(process.env.ETHEREAL_PORT ?? 587),
  secure: Number(process.env.ETHEREAL_PORT ?? 587) === 465,
  auth: process.env.ETHEREAL_USER && process.env.ETHEREAL_PASS
    ? { user: process.env.ETHEREAL_USER, pass: process.env.ETHEREAL_PASS }
    : undefined,
});

async function notifySlackOnce(userId: string, senderId: string, window: number, limit: number) {
  const noticeKey = `mail:slack-notified:${userId}:${senderId}:${window}`;
  if (await redis.set(noticeKey, '1', 'EX', 7200, 'NX') !== 'OK') return;
  try {
    const { rows } = await db.query('SELECT slack_access_token, slack_user_id FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user?.slack_access_token) return;
    const opened = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST', headers: { authorization: `Bearer ${decryptSecret(user.slack_access_token)}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ users: user.slack_user_id }),
    });
    const conversation = await opened.json() as { ok: boolean; channel?: { id: string }; error?: string };
    if (!conversation.ok || !conversation.channel?.id) throw new Error(conversation.error ?? 'Could not open Slack conversation');
    const result = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: `Bearer ${decryptSecret(user.slack_access_token)}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: conversation.channel.id, text: `A sender reached its hourly email limit (${limit}). The remaining scheduled emails will continue in the next hour.` }),
    });
    const response = await result.json() as { ok: boolean; error?: string };
    if (!response.ok) throw new Error(response.error ?? 'Slack notification failed');
  } catch (error) {
    await redis.del(noticeKey);
    console.warn('Slack rate-limit notification failed:', error instanceof Error ? error.message : error);
  }
}

export const worker = new Worker<JobData>('outbound-email', async (job: Job<JobData>, token?: string) => {
  const { rows } = await db.query('SELECT * FROM emails WHERE id = $1', [job.data.emailId]);
  const email = rows[0];
  if (!email || email.status === 'sent') return; // Stable BullMQ job ID plus this check makes retries idempotent.
  const sender = config.senders.find(item => item.id === email.sender_id);
  const senderUser = sender?.user ?? process.env.ETHEREAL_USER;
  const senderPass = sender?.pass ?? process.env.ETHEREAL_PASS;
  if (!senderUser || !senderPass) throw new Error('Configure Ethereal SMTP credentials before sending.');

  const slot = await reserveSenderSlot(email.sender_id, Number(email.hourly_limit) || config.hourlyLimit);
  if (!slot.allowed) {
    await notifySlackOnce(email.user_id, email.sender_id, slot.window, Number(email.hourly_limit) || config.hourlyLimit);
    const nextHour = slot.sendAt;
    await db.query('UPDATE emails SET scheduled_at=$2 WHERE id=$1', [email.id, new Date(nextHour)]);
    await job.moveToDelayed(nextHour, token!);
    throw new DelayedError();
  }
  const waitMs = slot.sendAt - Date.now();
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));

  await db.query("UPDATE emails SET status = 'sending', error = NULL WHERE id = $1 AND status <> 'sent'", [email.id]);
  try {
    const transport = sender ? nodemailer.createTransport({
      host: process.env.ETHEREAL_HOST ?? 'smtp.ethereal.email',
      port: Number(process.env.ETHEREAL_PORT ?? 587), secure: Number(process.env.ETHEREAL_PORT ?? 587) === 465,
      auth: { user: sender.user, pass: sender.pass },
    }) : smtp;
    const info = await transport.sendMail({
      from: config.emailFrom, to: email.recipient, subject: email.subject, text: email.body,
      messageId: `<${email.id}@reachinbox.local>`,
    });
    await db.query("UPDATE emails SET status = 'sent', sent_at = now(), error = NULL WHERE id = $1", [email.id]);
    await indexEmail({ id: email.id, userId: email.user_id, senderId: email.sender_id,
      recipient: email.recipient, subject: email.subject, body: email.body,
      scheduledAt: email.scheduled_at, status: 'sent', sentAt: new Date().toISOString(),
      previewUrl: nodemailer.getTestMessageUrl(info) });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown SMTP error';
    await db.query("UPDATE emails SET status = 'failed', error = $2 WHERE id = $1", [email.id, message]);
    throw error;
  }
}, { connection: redis, concurrency: Math.max(1, config.concurrency) });

worker.on('failed', async (job, error) => {
  console.error(`Email job ${job?.id} failed:`, error.message);
  if (job && job.attemptsMade >= Number(job.opts.attempts ?? 1)) {
    await db.query("UPDATE emails SET status='failed', error=$2 WHERE id=$1 AND status <> 'sent'", [job.data.emailId, error.message.slice(0, 500)]);
  }
});
worker.on('error', error => console.error('Queue worker error:', error));
