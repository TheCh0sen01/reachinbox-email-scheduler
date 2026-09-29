import { db, initializeDatabase } from './db.js';
import { emailQueue, scheduleEmail, redis } from './queue.js';

async function startWorker() {
  await initializeDatabase();
  // PostgreSQL is authoritative. Re-add missing BullMQ jobs by deterministic email ID after restarts.
  const pending = await db.query("SELECT id, scheduled_at FROM emails WHERE status IN ('scheduled','sending')");
  for (const email of pending.rows) {
    if (!(await emailQueue.getJob(email.id))) await scheduleEmail({ id: email.id, scheduledAt: new Date(email.scheduled_at) });
  }
  const { worker } = await import('./worker.js');
  console.log('ReachInbox email worker is ready.');
  const shutdown = async () => { await worker.close(); await emailQueue.close(); await redis.quit(); await db.end(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}

startWorker().catch(error => { console.error('Could not start ReachInbox worker:', error); process.exit(1); });
