import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
export const emailQueue = new Queue('outbound-email', { connection: redis, defaultJobOptions: {
  attempts: 5, backoff: { type: 'exponential', delay: 3000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10000 },
  removeOnFail: { age: 30 * 24 * 60 * 60, count: 10000 },
} });

export async function scheduleEmail(email: { id: string; scheduledAt: Date }) {
  await emailQueue.add('send', { emailId: email.id }, {
    jobId: email.id,
    delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
  });
}
