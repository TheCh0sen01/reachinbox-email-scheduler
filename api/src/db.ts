import { Pool } from 'pg';

export const db = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://reachinbox:reachinbox@localhost:5432/reachinbox' });

export async function initializeDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, avatar text,
      slack_access_token text, slack_team_id text, slack_team_name text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS emails (
      id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), sender_id text NOT NULL,
      recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
      scheduled_at timestamptz NOT NULL, hourly_limit integer NOT NULL DEFAULT 40,
      status text NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','sending','sent','failed')),
      sent_at timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS emails_user_status_date ON emails(user_id, status, scheduled_at);
    CREATE INDEX IF NOT EXISTS emails_user_recipient ON emails(user_id, recipient);
    CREATE UNIQUE INDEX IF NOT EXISTS emails_idempotent_recipient ON emails(user_id, recipient, subject, scheduled_at);
    ALTER TABLE emails ADD COLUMN IF NOT EXISTS hourly_limit integer NOT NULL DEFAULT 40;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_user_id text;
  `);
}
