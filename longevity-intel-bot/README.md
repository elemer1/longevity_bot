# Compound Longevity Intelligence Bot

Cloud-first MVP for a daily Longevity Science intelligence bot:

- Fetches candidates from PubMed, arXiv, RSS feeds, Reddit RSS, and optional Tavily web search.
- Uses DeepSeek to select and explain the top 5 daily items for non-medical readers.
- Labels evidence type, credibility, impact, actionability, and caveats.
- Records run-quality metrics: source coverage, source warnings, topic mix, high-credibility count, human-evidence count, and candidate-pool warnings.
- Provides an internal web admin for sources, candidates, report editing, push status, and history.
- Pushes the daily report to Lark through a custom bot webhook.
- Runs daily in the cloud through Vercel Cron.

## Stack

- Next.js App Router
- Neon/Postgres through `@neondatabase/serverless`
- DeepSeek Chat Completions API
- Lark custom bot webhook
- Vercel Cron

## Environment

Copy `.env.example` to `.env.local` for local verification or configure the same variables in Vercel.

Required for production persistence and delivery:

- `DATABASE_URL`
- `DEEPSEEK_API_KEY`
- `LARK_WEBHOOK_URL`

Recommended:

- `ADMIN_TOKEN` protects the admin console.
- `CRON_SECRET` protects `/api/cron/daily`.
- `LARK_WEBHOOK_SECRET` signs Lark custom bot requests if the bot enables signature verification.

Optional:

- `TAVILY_API_KEY` adds broader web search coverage.
- `DEEPSEEK_MODEL` defaults to `deepseek-v4-flash`.

## Commands

```bash
npm install
npm run dev
npm run build
```

## Cloud deploy

1. Create a Neon Postgres database and copy its connection string to `DATABASE_URL`.
2. Create a Lark group custom bot and copy its webhook URL to `LARK_WEBHOOK_URL`.
3. Add the environment variables in Vercel.
4. Deploy this folder to Vercel.
5. Vercel Cron will call `/api/cron/daily` at `01:00 UTC`, which is `09:00 Asia/Shanghai`.

The first production request auto-creates the required tables and seeds default sources.

## API

- `GET /api/dashboard` returns current sources, candidates, latest report, and run history.
- `POST /api/run` fetches candidates, ranks them, and saves today's report.
- `POST /api/send` sends a report to Lark.
- `PATCH /api/report` updates report Markdown/status.
- `GET /api/settings` checks runtime configuration and latest operational status.
- `POST /api/settings` runs connection tests for Lark and DeepSeek.
- `GET/POST/PATCH /api/sources` manages sources.
- `GET /api/cron/daily` runs and sends the daily report.
