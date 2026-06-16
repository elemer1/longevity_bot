# Architecture

## Daily loop

1. Vercel Cron calls `/api/cron/daily`.
2. The pipeline loads enabled sources from Postgres.
3. Fetchers collect recent candidates from:
   - PubMed E-utilities
   - arXiv Atom API
   - RSS and Atom feeds
   - Reddit RSS
   - optional Tavily search
4. Candidates are normalized and deduplicated by URL/title hash.
5. The pre-ranker filters obvious noise, weighs title-level longevity specificity, and records source/topic coverage quality.
6. DeepSeek ranks the day and generates a Chinese, non-specialist report.
7. The report is saved to Postgres with run-quality notes appended.
8. The report is pushed to Lark using a custom bot webhook.
9. The run record is saved with counts, source warnings, topic mix, and delivery status.

## Importance rubric

AI ranking is instructed to optimize for:

- Evidence quality: human RCTs and clinical evidence outrank animal, cell, and anecdotal reports.
- Translational relevance: plausible path to human healthspan impact.
- Novelty: new mechanism, target, biomarker, intervention, or meaningful replication.
- Source credibility: primary literature and reputable scientific sources outrank community anecdotes.
- Signal over hype: supplement marketing, single-person experiments, and speculative claims are penalized.
- Portfolio breadth: avoid five versions of the same mechanism unless that is the day's clear story.
- Title-level specificity: PubMed/arXiv items whose titles do not clearly signal longevity, biological age, healthspan, lifespan, geroscience, frailty, progeria, senolytics, or closely adjacent aging biology are downgraded even if the abstract contains broad mechanism terms.

## Production notes

- X/Twitter is represented as a source type but is not enabled by default. The official API is permissioned and can be added as a fetcher without changing the rest of the pipeline.
- The admin settings page exposes operational checks for storage, DeepSeek, Lark, Cron, Tavily, and admin protection. It can trigger scans, trigger send runs, and send a lightweight Lark test message.
- If `DEEPSEEK_API_KEY` is absent, the app falls back to deterministic scoring so the admin UI remains testable.
- If `DATABASE_URL` is absent, the app uses in-memory demo storage for local verification only.
