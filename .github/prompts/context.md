# Project context: AI-or-Not

## What this is

AI-or-Not (`lenaxia/AI-or-Not`) is a Next.js 16 web game. Two photos appear
side by side; the player guesses which are AI-generated (Left / Right / Both /
Neither). 10 rounds per game, then a final score with rank/percentile against
all players in the same mode.

The defining constraint: **images are served through an opaque server proxy so
the source folder (`ai/` vs `real/`) and filename never reach the browser.**
Players cannot cheat by inspecting URLs. This is the core OPSEC invariant — do
not break it.

## Stack

- **Next.js 16** (App Router, TypeScript, Route Handlers) — note: this is NOT
  the Next.js from training data. Breaking changes. Read
  `node_modules/next/dist/docs/` before touching framework APIs.
- **React 19** Server + Client Components
- **shadcn/ui** (Base UI primitives, not Radix) + Tailwind CSS v4
- **Recharts** for the score distribution histogram
- **Zod** for all API request validation
- **Drizzle ORM** + **@libsql/client** (embedded SQLite locally, swappable to
  Turso/Postgres via `ROA_DB_URL`)

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── game/round/route.ts     # GET — picks 2 images, returns IDs + signed token
│   │   ├── game/guess/route.ts     # POST — verifies token, returns {correct, truth}
│   │   ├── game/start/route.ts     # POST — issues game session token
│   │   ├── img/[id]/route.ts       # GET — source-hidden image proxy (HMAC IDs)
│   │   └── leaderboard/route.ts    # GET preview, POST submit
│   └── components/                  # Game (state machine), Distribution (Recharts)
├── db/                             # Drizzle schema + client
└── lib/                            # catalog, game, crypto, schemas, types
images/{ai,real}/                   # image folders (content gitignored)
```

### Trust model

- The **round token** is HMAC-signed and encodes the truth (which side is AI).
  The client cannot read it. The server verifies it on guess submission.
- The **image ID** is an HMAC of the on-disk relative path (24-char hex
  prefix). It is opaque — neither the label (`ai`/`real`) nor the filename
  leaks. Do not add endpoints that reveal the mapping.
- **Score submission** is server-validated: a game session token is issued at
  start, the server tracks correct-guess count, and the leaderboard reads from
  server state (the client does not self-report its score).

### What "correct" means for this codebase

- **The source-hidden proxy is sacred.** Never expose `images/ai/` vs
  `images/real/` to the client. Never add an endpoint that lists filenames.
  Image IDs must remain HMAC-derived and unguessable.
- **Server-side state is the source of truth for scores.** The client's
  `{correct, total}` is not trusted; the server counts correct guesses per
  game-token.
- **`ROA_SECRET` must be set in production.** The default dev secret is
  compile-time-visible; with it, round tokens are forgeable.
- **No new dependencies without justification.** The stack is deliberately
  minimal. Prefer `node:crypto` over a JWT lib; prefer Drizzle's query builder
  over raw SQL strings.

## File map for reviewers

| If the diff touches… | Watch for |
| --- | --- |
| `src/lib/crypto.ts` | Token forgery surface; timing-safe comparison |
| `src/app/api/img/[id]/route.ts` | Path traversal; source label leaking in headers |
| `src/app/api/game/*.ts` | Token verification; truth leaking in response |
| `src/app/api/leaderboard/route.ts` | Self-reported scores; rate-limit bypass |
| `src/lib/catalog.ts` | Filesystem tracing warnings; unfiltered extensions |
| `Dockerfile` | Running as root; secrets baked in; missing volume mounts |
| `.github/workflows/*.yml` | Non-pinned action versions; `@v0.2.7` ai-workflows drift |

## Tests

`vitest` covers `lib/crypto.ts` (sign/verify round-trip, tamper detection),
`lib/game.ts` (round builder truth distribution, token decode), and
`lib/leaderboard.ts` math (percentile, bucketing, median). Run with `npm test`.

## Out of scope for AI agents

- Do not push directly to `main`. Open a PR.
- Do not edit `.github/workflows/release.yml` or `docker-publish.yml` without
  also verifying the action versions are current.
- Do not modify `.release-please-manifest.json` without coordinating — it
  anchors the semver baseline.
