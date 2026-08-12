# AI-or-Not

[![Release](https://img.shields.io/github/v/release/lenaxia/AI-or-Not?display_name=tag&include_prereleases)](https://github.com/lenaxia/AI-or-Not/releases)
[![CI](https://github.com/lenaxia/AI-or-Not/actions/workflows/release.yml/badge.svg)](https://github.com/lenaxia/AI-or-Not/actions/workflows/release.yml)
[![Docker](https://github.com/lenaxia/AI-or-Not/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/lenaxia/AI-or-Not/actions/workflows/docker-publish.yml)
[![Container](https://img.shields.io/badge/container-ghcr.io-blue?logo=docker)](https://github.com/lenaxia/AI-or-Not/pkgs/container/ai-or-not)

> Two photos appear. One is real, one is AI-generated. **Can you tell which?**
> Click the fake across 10 rounds and see where you land on the player distribution.

AI-or-Not is a game that tests whether you can spot AI-generated images.
Every round shows two photos side by side — exactly one is AI, one is real.
Click the one you think is fake. A coin-flip scores ~50%, so real skill
shows up in the curve.

The backend serves every image through an **opaque, server-proxied endpoint**
so the source of each photo is never exposed to the browser. Players can't
cheat by inspecting filenames, URLs, or the network tab. No per-round
feedback is given — answers are revealed in an end-of-game review gallery.

## Project goals

This is a **fun project**, not enterprise software. We optimize for, in
priority order:

1. **Functional** — the features actually work.
2. **Performant enough** — rounds stay snappy under casual load; nothing does
   obviously wasteful work on the hot path.
3. **Simple** — few knobs, little config surface, easy to run locally.

Security and feature richness are explicitly **not** top priorities. Auth is
a shared password; we don't build for scale we don't have. If you're looking
for a hardened, multi-tenant, audit-logged image-classification platform,
this isn't it — and that's by design.

### Roadmap

Active design work lives under [`docs/backlog/`](./docs/backlog). The current
epic covers **S3 image sourcing**, **per-image ELO ranking**, **SHA1-based
dedup**, and a small **admin portal**:

→ [`docs/backlog/epic01-s3-elo-admin/README.md`](./docs/backlog/epic01-s3-elo-admin/README.md)

## Features

- **Click-to-pick** — click the image you think is AI; no secondary buttons
- **Easy** and **Hard** modes — Hard hides the images after 2 seconds
- **Leaderboard & distribution** — rank, percentile, mean, and a histogram
  of all scores in the same mode
- **Source-hidden image proxy** — HMAC-derived opaque IDs, signed round tokens
- **SQLite** storage (Drizzle ORM + libsql; swappable to Turso/Postgres)

## Quickstart (Docker)

The image is published to GHCR on every release.

```bash
docker pull ghcr.io/lenaxia/ai-or-not:latest
docker run --rm -p 3000:3000 \
  -v ./images:/app/images \
  -v ./data:/app/data \
  ghcr.io/lenaxia/ai-or-not:latest
```

Open <http://localhost:3000>. Tag variants: `:vX.Y.Z`, `:vX.Y`, `:vX`,
`:latest`, `:sha-<short>`. Multi-arch: `linux/amd64`, `linux/arm64`.

Mount your own `images/ai/` and `images/real/` folders to replace the
baked-in placeholders (see [Adding images](#adding-images) below).

## Quickstart (local dev)

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The app ships with labeled placeholder images
so it runs immediately — replace them to make it a real game.

## Tech

- [Next.js 16](https://nextjs.org) (App Router, TypeScript, Route Handlers)
- [shadcn/ui](https://ui.shadcn.com) (Base UI) + Tailwind CSS v4
- [Recharts](https://recharts.org) for the score distribution chart
- [Zod](https://zod.dev) for API request validation
- [Drizzle ORM](https://orm.drizzle.team) + [@libsql/client](https://github.com/tursodatabase/libsql-client-ts)

## Adding images

Drop image files into either folder. Supported types: `.jpg` `.jpeg` `.png`
`.webp` `.gif` `.avif` `.bmp` `.svg`. You need **at least 10 images in each
folder** (one unique pair per round — images don't repeat within a game).

```
images/
├── ai/        # AI-generated images
└── real/      # real photos
```

### Suggested sources

**Real photos** (check each source's license/terms before scraping):

- [500px](https://500px.com), [Flickr](https://flickr.com) (CC via the [Flickr API](https://www.flickr.com/services/api/))
- [Unsplash](https://unsplash.com/developers), [Pexels](https://www.pexels.com/api/), [Wikimedia Commons](https://commons.wikimedia.org)

**AI images:**

- [r/StableDiffusion](https://www.reddit.com/r/StableDiffusion/), [r/midjourney](https://www.reddit.com/r/midjourney/) (via the Reddit API)
- [Civitai](https://civitai.com)
- Generate your own with Stable Diffusion / Midjourney / DALL·E

## Database

Scores persist to a local SQLite file (`data/ai-or-not.db`, auto-created on
first run). The schema is auto-applied on startup, so no migration step is
required for local dev. For production, generate and run migrations:

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
| `ROA_DB_URL` | `file:./data/ai-or-not.db` | libsql/SQLite database URL |
| `TURSO_DATABASE_URL` | — | Turso remote DB URL (overrides `ROA_DB_URL`) |
| `TURSO_AUTH_TOKEN` | — | Turso auth token |
| `ROA_SECRET` | *(dev default)* | Secret used to sign round tokens & hash image IDs — **set this in production** |
| `ROA_ELO_RETIRE_BELOW` | `600` | Images with ELO below this are excluded from rotation (empty-pool fallback applies) |
| `ROA_S3_BUCKET` | — | When set, the bucket becomes an image source (alongside the local FS) |
| `ROA_S3_REGION` | — | AWS region for the bucket |
| `ROA_S3_PREFIX_AI` | `ai/` | Key prefix for AI-generated images in the bucket |
| `ROA_S3_PREFIX_REAL` | `real/` | Key prefix for real photos in the bucket |
| `ROA_S3_ENDPOINT` | — | Custom endpoint for S3-compatible backends (R2, MinIO, B2) |
| `ROA_S3_FORCE_PATH_STYLE` | `false` | `true` for some S3-compatible backends |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | — | Standard AWS SDK credential chain (used iff `ROA_S3_BUCKET` is set; IAM role also works) |
| `ROA_ADMIN_PASSWORD` | — | When set, the admin portal at `/admin` and `/api/admin/*` are enabled (shared password) |

## Releases

Releases are automated via [release-please](https://github.com/googleapis/release-please)
and driven by [Conventional Commits](https://www.conventionalcommits.org/):

| Commit prefix | Bump | Example |
| --- | --- | --- |
| `feat:` | minor | `feat: add sound effects` → `v0.2.0` |
| `fix:`, `perf:` | patch | `fix: score calc off-by-one` → `v0.1.1` |
| `feat!:`, `BREAKING CHANGE:` footer | major | `feat!: new schema` → `v1.0.0` |
| `chore:`, `docs:`, `test:`, `ci:`, `refactor:` | none | no release triggered |

Each push to `main` opens/updates a **release PR**. Merge it to cut a tag and
publish the Docker image.

## How it works

1. `GET /api/game/round?mode=easy|hard` → returns two opaque image IDs + a
   signed token. The token encodes the **truth** (which side(s) are AI) but
   only the server can read it.
2. Images are fetched via `GET /api/img/[id]` — the ID is an HMAC of the
   on-disk path, so neither the folder (`ai` vs `real`) nor the filename leaks.
3. `POST /api/game/guess` `{ token, guess }` → server verifies the token and
   returns `{ correct, truth }`.
4. `POST /api/leaderboard` `{ correct, total, mode }` → saves the score and
   returns rank, percentile, mean, median, and a score distribution histogram.

## Project layout

```
src/
├── app/
│   ├── api/
│   │   ├── game/{round,guess}/route.ts   # round builder + answer checker
│   │   ├── img/[id]/route.ts             # source-hidden image proxy
│   │   └── leaderboard/route.ts          # score submission + stats
│   ├── components/                       # Game (state machine) + Distribution
│   └── layout.tsx, page.tsx
├── db/                                   # Drizzle schema + client
└── lib/                                  # catalog, game, crypto, schemas, types
images/{ai,real}/                         # image folders (gitignored content)
```

## License

MIT
