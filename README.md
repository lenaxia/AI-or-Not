# Real or AI?

A game where two photos appear side by side — one, both, or neither may be
AI-generated. You guess which. Score 10 rounds and see where you land on the
player distribution.

The backend serves every image through an opaque, server-proxied endpoint so the
**source of each photo is never exposed** to the browser — players can't cheat by
inspecting filenames or URLs.

## Features

- **A / B / None / Both** guessing (random scores ~25%, so skill shows in the curve)
- **Easy** and **Hard** modes (Hard hides the images after 2 seconds)
- **Leaderboard & distribution** — rank, percentile, mean, and a histogram of all
  scores in the same mode
- **Source-hidden image proxy** — HMAC-derived opaque IDs, signed round tokens
- **SQLite** storage (Drizzle ORM + libsql; swappable to Turso/Postgres)

## Tech

- [Next.js 16](https://nextjs.org) (App Router, TypeScript, Route Handlers)
- [shadcn/ui](https://ui.shadcn.com) (Base UI) + Tailwind CSS v4
- [Recharts](https://recharts.org) for the score distribution chart
- [Zod](https://zod.dev) for API request validation
- [Drizzle ORM](https://orm.drizzle.team) + [@libsql/client](https://github.com/tursodatabase/libsql-client-ts)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app ships with labeled placeholder images so it runs immediately. To make it
a real game, drop your own images into `images/ai/` and `images/real/` and delete
the placeholders — see [`images/README.md`](./images/README.md) for sourcing
ideas (500px, Flickr, r/StableDiffusion, Civitai, …) and supported file types.

You need **at least 2 images in each folder** to play.

## Database

Scores persist to a local SQLite file (`data/realorai.db`, auto-created on first
run). The schema is auto-applied on startup, so no migration step is required for
local dev. For production, generate and run migrations:

```bash
npm run db:generate   # create a migration from the schema
npm run db:migrate    # apply migrations
```

### Postgres / Turso

To use a remote database instead of the local file, set env vars:

```bash
# Turso (libsql remote)
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=...

# or any libsql URL
ROA_DB_URL=...
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROA_IMAGES_DIR` | `./images` | Root folder containing `ai/` and `real/` |
| `ROA_DB_URL` | `file:./data/realorai.db` | libsql/SQLite database URL |
| `TURSO_DATABASE_URL` | — | Turso remote DB URL (overrides `ROA_DB_URL`) |
| `TURSO_AUTH_TOKEN` | — | Turso auth token |
| `ROA_SECRET` | *(dev default)* | Secret used to sign round tokens & hash image IDs — **set this in production** |

## How it works

1. `GET /api/game/round?mode=easy|hard` → returns two opaque image IDs + a signed
   token. The token encodes the **truth** (which side(s) are AI) but only the
   server can read it.
2. Images are fetched via `GET /api/img/[id]` — the ID is an HMAC of the on-disk
   path, so neither the folder (`ai` vs `real`) nor the filename leaks.
3. `POST /api/game/guess` `{ token, guess }` → server verifies the token and
   returns `{ correct, truth }`.
4. `POST /api/leaderboard` `{ correct, total, mode }` → saves the score and
   returns rank, percentile, mean, median, and a score distribution histogram.
