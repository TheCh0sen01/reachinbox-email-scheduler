# ReachInbox Scheduler

A small email operations app for people who would rather send fewer, more thoughtful notes. Upload a recipient list, write one message, pick the first send time and pacing, then follow each email from scheduled to sent (or see why it failed).

## What the assignment means

The dashboard is the front door. An Express API saves one row per recipient in PostgreSQL. BullMQ places delayed jobs in Redis; a separate worker sends them through Ethereal SMTP. The database and queue together let future sends survive process restarts. Redis coordinates sender pacing and hourly limits across worker instances. Elasticsearch makes message text searchable. Google OAuth signs people in; Slack OAuth connects a workspace for real hourly-limit alerts. Bull Board exposes the live queue behind sign-in.

## Stack and layout

- `web/`: React + TypeScript + Vite + Tailwind CSS
- `api/`: Express + TypeScript, Google and Slack OAuth, email API, BullMQ worker
- PostgreSQL: email state, users, encrypted Slack OAuth tokens, sessions
- Redis: persistent BullMQ jobs and atomic per-sender pacing/rate-limit counters
- Elasticsearch: searchable message index (PostgreSQL remains the source of truth)
- `docker-compose.yml`: local PostgreSQL, Redis, and optional Elasticsearch

## Run locally

1. Install Node.js 20 or newer and Docker Desktop.
2. Copy `.env.example` to `.env`, then replace the secrets and OAuth values below.
3. Start PostgreSQL and Redis: `npm run infra:up`. Start optional Elasticsearch with `docker compose --profile search up -d elasticsearch`.
4. Install JavaScript packages: `npm install`.
5. Start API and UI together: `npm run dev`.
6. Open [http://localhost:5173](http://localhost:5173). Google OAuth must be configured; there is no pretend sign-in mode.

For a production build, run `npm run build`, set `NODE_ENV=production` and `APP_URL` to the deployed origin, then run `npm start` from the repository root. The API serves `web/dist` in production. Put the app behind HTTPS and set secure cookie settings through the production environment.

## External credentials

**Ethereal:** Create a test SMTP account at [ethereal.email](https://ethereal.email/create). Set `ETHEREAL_USER`, `ETHEREAL_PASS`, `ETHEREAL_HOST`, and `ETHEREAL_PORT`. Ethereal captures test messages; they are not delivered to real recipients. For multiple sending accounts, set `SENDERS_JSON` to a JSON array such as `[ {"id":"team-a","name":"Team A","user":"...","pass":"..."}, {"id":"team-b","name":"Team B","user":"...","pass":"..."} ]`. Keep these values in `.env`, never in the browser.

**Google:** Create a Google OAuth web client. Add `http://localhost:4000/auth/google/callback` as an authorized redirect URI. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL`.

**Slack:** Create a Slack app with bot scopes `chat:write` and `im:write`, and add `http://localhost:4000/auth/slack/callback` as its OAuth redirect URL. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_CALLBACK_URL`. In the dashboard, the user connects or disconnects the workspace. The bot opens a DM to the installing user and sends a message when their sender hits its hourly limit. Missing Slack configuration is handled without failing email jobs. Set `TOKEN_ENCRYPTION_KEY` to 32 random bytes in hex (64 hex characters) so the OAuth token is encrypted with AES-256-GCM in PostgreSQL.

## Scheduling, persistence, and throughput

- Scheduling creates a PostgreSQL record per unique `(user, recipient, subject, scheduled time)` and enqueues the job with that row's stable ID. Repeated API submissions for the same recipient/message/time resolve to the existing database record; BullMQ's job ID prevents a second queued job.
- Redis runs with AOF persistence (`appendonly yes`, `appendfsync everysec`). On API startup, pending database rows are reconciled into BullMQ by deterministic ID, so a missing Redis job is restored without rebuilding the schedule from scratch. PostgreSQL remains the source of truth.
- `WORKER_CONCURRENCY` controls worker concurrency. `MIN_SEND_GAP_MS` is a global minimum spacing per sender; the default is 2,000 ms. An atomic Lua script reserves the sender's next slot and counts reservations in a Redis key per sender and UTC hour. This is shared safely by parallel jobs and API instances.
- `MAX_EMAILS_PER_HOUR_PER_SENDER` sets the default hourly limit (40). A schedule can choose a smaller or larger positive limit. When the limit for the next send window is full, BullMQ delays that job to the next UTC hour; the email stays in the queue and is not permanently failed. Jobs are reserved in queue order as workers process them.
- Queue jobs retry transient failures with exponential backoff. Successful rows are marked sent and retries check the database before sending again. A stable SMTP `Message-ID` is also used. SMTP itself does not provide a transaction shared with PostgreSQL, so a process crash in the narrow interval after SMTP accepts a message but before the database commit leaves an inherently uncertain delivery outcome; strict exactly-once delivery cannot be promised by SMTP alone. The app does deduplicate schedule requests and queue jobs.
- 1,000 emails arriving together become 1,000 persisted delayed jobs. Worker concurrency bounds active work; sender reservations enforce pacing and hourly quotas. Excess work remains delayed in Redis and is not dropped.
- No cron process or cron library is used. Timing is handled by BullMQ delayed jobs.

## APIs and dashboard

- `GET /auth/google` starts real Google sign-in; `GET /auth/me` returns the session user.
- `POST /api/emails/schedule` accepts `subject`, `body`, `recipients`, `startAt`, `delaySeconds`, `hourlyLimit`, and optional `senderId`.
- `GET /api/emails?status=scheduled|sending|sent|failed&q=...` lists or searches a signed-in user's email activity.
- `GET /api/emails/queue` returns queue counts. `GET /admin/queues` opens the authenticated Bull Board UI.
- `GET /auth/slack` starts Slack OAuth; `DELETE /auth/slack` disconnects the workspace.

The dashboard includes Google profile and logout, scheduled/sent activity, CSV/text recipient detection, a compose flow, queue visibility, Slack connection, loading/error/empty states, and search. It uses the API; it does not keep fake sample activity.

## Trade-offs and demo notes

This is an assignment-sized implementation. OAuth and SMTP require your own credentials, Elasticsearch is optional during local startup (PostgreSQL search remains available), and Ethereal only previews test messages. The Figma link was provided, but the UI uses an original quiet, people-first visual direction rather than claiming a pixel-perfect copy. Keep `.env` private. A production deployment should also add provider-specific bounce handling and operational monitoring.
