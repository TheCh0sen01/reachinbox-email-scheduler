import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Find the repository's .env even when VS Code launches the API from api/.
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const findEnvFile = (startDirectory: string): string | undefined => {
  let directory = path.resolve(startDirectory);
  while (true) {
    const envPath = path.join(directory, '.env');
    if (existsSync(envPath)) return envPath;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
};

const envPath = findEnvFile(process.cwd()) ?? findEnvFile(moduleDirectory);
if (envPath) dotenv.config({ path: envPath });

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
};

export const config = {
  port: number('PORT', 4000),
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  sessionSecret: process.env.SESSION_SECRET ?? 'local-only-change-me',
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? '',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://reachinbox:reachinbox@localhost:5432/reachinbox',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  elasticsearchUrl: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',
  concurrency: number('WORKER_CONCURRENCY', 5),
  minSendGapMs: number('MIN_SEND_GAP_MS', 2000),
  hourlyLimit: number('MAX_EMAILS_PER_HOUR_PER_SENDER', 40),
  emailFrom: process.env.EMAIL_FROM ?? 'ReachInbox Demo <hello@example.test>',
  senders: JSON.parse(process.env.SENDERS_JSON ?? '[]') as { id: string; name: string; user: string; pass: string }[],
};

export const isGoogleReady = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const isSlackReady = Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
