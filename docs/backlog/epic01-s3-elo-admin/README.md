# Epic 01 — S3 Image Sourcing, ELO Ranking & Admin Portal

> Status: **Design / Backlog**
> Scope: turn the static filesystem image catalog into a managed, ranked,
> deduplicated, multi-source (local FS + S3) image library with an admin UI.

## Design lens

This is a fun project, not enterprise. Priorities, in order:

1. **Functional** — the features actually work.
2. **Performant enough** — rounds stay snappy under casual load; nothing does
   obviously wasteful work on the hot path.
3. **Simple** — few knobs, little config surface, easy to run locally.
4. Security and feature richness are explicitly **not** goals. Auth is a
   shared password. We don't build for scale we don't have.

Everything below is judged against that order.

## Goals / Non-goals

**Goals:** sourced imagery from S3 (one bucket, two prefixes); per-image ELO
so hard images surface and trivial ones retire; a small admin portal to
browse/upload/inspect.

**Non-goals:** player accounts or player-skill ELO; multi-tenant buckets; a
real CMS; replacing the game/leaderboard flow.

---

## Stress-test notes (read first)

These are the failure modes worth caring about for a project this size, with
the cheap fix for each. Everything else (concurrency on S3 ListObjects,
pagination, credential rotation, CSRF on admin, etc.) is explicitly out of
scope at this size.

1. **Don't kill the in-memory catalog.** Today `catalog.ts` caches the scan
   in a `Promise` and serves every round from memory — one syscall on boot,
   zero per round. A naive DB rewrite that runs `SELECT … ORDER BY RANDOM()`
   per round is a regression: SQLite's `ORDER BY RANDOM()` is a full table
   scan. **Fix:** DB is the source of truth; keep an in-memory array per
   label for `pickByLabel`, bust it on upload/reindex/delete. Hot path stays
   O(1) memory reads.

2. **ELO write must be atomic.** Read-modify-write of `elo` loses updates
   when two guesses land on the same image in the same tick (very likely —
   popular images get picked often). **Fix:** one statement,
   `UPDATE images SET elo = elo + ?, appearances = appearances + 1,
   fools = fools + ? WHERE id = ?`. No app-side read, no race.

3. **Retirement must not empty the pool.** If every image of a label dips
   below the retirement floor, `buildRound` returns null → 503 and the game
   is broken. **Fix:** in `pickByLabel`, if the filtered pool has < 2
   entries, fall back to all `active` rows of that label ignoring the floor.

4. **Reindex cost is dominated by hashing, not listing.** S3 `ListObjects`
   is cheap and paginated; `GetObject` to SHA1 every object is the bill
   (time + egress). For a few hundred images, who cares. For thousands,
   reindex will block the HTTP request and time out. **Fix (v1, good
   enough):** keep reindex synchronous but cache SHA1 by S3 ETag, so a
   re-run after the first is nearly free; document that giant buckets
   should be reindexed from a one-off script, not the admin button.

5. **ETag fast-path for dedup.** For S3 objects uploaded as a single part
   (true for basically all images under 5MB), the ETag *is* the MD5 of the
   content. Use it as a first-pass dedup key and only fetch+SHA1 on ETag
   collision. Cuts reindex work to near-zero on the steady-state path.

6. **Upload needs a size cap.** A multipart route with no limit is trivially
   OOM'd. One line: `export const runtime = "nodejs"` + a body-size check
   (e.g. reject > 25 MB/file). No streaming wizardry needed at this size.

7. **Brand-new images enter rotation immediately.** A "warmup" appearance
   floor is a knob with little payoff for a fun project — new images at
   baseline 1000 are fine. Cut.

8. **Admin thumbnails are browser-scaled full images.** Loading a 200-tile
   gallery this way is bandwidth-heavy but trivially fine for an
   operator-only page over fast networks. Revisit only if it actually feels
   slow.

---

## Feature 1 — S3 image sourcing

### Config

New env vars (all optional; when unset, behavior falls back to local FS):

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROA_S3_BUCKET` | — | Bucket name. When set, S3 becomes a source. |
| `ROA_S3_REGION` | — | AWS region. |
| `ROA_S3_PREFIX_AI` | `ai/` | Key prefix for AI images. |
| `ROA_S3_PREFIX_REAL` | `real/` | Key prefix for real photos. |
| `ROA_S3_ENDPOINT` | — | Optional — for R2 / MinIO / B2. |
| `ROA_S3_FORCE_PATH_STYLE` | `false` | `true` for some S3-compatible backends. |

Credentials use the standard AWS SDK chain (`AWS_ACCESS_KEY_ID` etc.) — no
custom cred vars.

### Indexer

On boot + on admin "reindex": for each source × label, list entries with a
supported extension, dedup against the `images` table by content hash, upsert
new rows, and mark rows whose locator vanished as deleted (hard delete — we
don't soft-delete at this scale). Idempotent; never touches ELO.

Steady-state cost is near-zero thanks to the ETag fast-path (stress note #5).

### Image proxy

`GET /api/img/[id]` stays the public, source-hidden endpoint. Internally:
resolve id → row → source. FS: `fs.readFile`. S3: stream `GetObject` straight
into the response. Same headers/cache as today. No client-facing change.

### Library

`@aws-sdk/client-s3` (v3) — works against vanilla S3 and compatible backends
via `ROA_S3_ENDPOINT`.

---

## Feature 2 — ELO ranking

### Semantics

Each image has an ELO = "how often it fools players." Misclassified → up.
Trivially-guessed → down → retires from rotation.

### Per-image outcome

From the player's `left|right|both|none` verdict, derive a binary "did the
image fool the player on this appearance":

| Image label | Side | Player says AI for this side? | Image fooled player? |
| --- | --- | --- | --- |
| `ai` | left | guess ∈ {left, both} | **No** (player caught it) |
| `ai` | right | guess ∈ {right, both} | **No** |
| `ai` | left | guess ∈ {right, none} | **Yes** |
| `ai` | right | guess ∈ {left, none} | **Yes** |
| `real` | left | guess ∈ {left, both} | **Yes** (player wrongly flagged it AI) |
| `real` | right | guess ∈ {right, both} | **Yes** |
| `real` | left | guess ∈ {right, none} | **No** |
| `real` | right | guess ∈ {left, none} | **No** |

### Update

Standard Elo vs. a fixed population baseline (no player skill tracking —
non-goal). Hardcoded constants, one knob:

```
expected = 1 / (1 + 10 ** ((1000 - image.elo) / 400))
actual   = 1 if image fooled the player else 0
Δelo     = 32 * (actual - expected)
```

Applied as a single atomic SQL statement (stress note #2):

```sql
UPDATE images
SET elo = MAX(100, elo + ?),
    appearances = appearances + 1,
    fools = fools + ?
WHERE id = ?
```

Wiring: extract outcomes in `POST /api/game/guess` after the round token is
decoded (we know each image's label, side, and the guess), fire the update
for both images. `pickByLabel` excludes retired images (ELO below
`ROA_ELO_RETIRE_BELOW`, default `600`) with the empty-pool fallback
(stress note #3).

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROA_ELO_RETIRE_BELOW` | `600` | ELO floor for rotation eligibility. |

That's the only ELO knob. `K=32`, baseline `1000`, hard floor `100` are
hardcoded — standard values, no reason to expose them.

---

## Feature 3 — Admin portal

### Auth

One env var: `ROA_ADMIN_PASSWORD`. Unset → `/admin` returns 404, full stop.
Set → `POST /api/admin/login` checks the password and sets a signed cookie
(reuse the existing `sign()`/`verify()` in `src/lib/crypto.ts`, 8h TTL,
`httpOnly`). That's it. No CSRF token, no rate-limit beyond the global one,
no user list. It's a shared password on a fun project.

### Routes

All `POST`, all cookie-gated, no REST verb fanciness:

| Path | Body | Returns |
| --- | --- | --- |
| `/api/admin/login` | `{ password }` | sets cookie |
| `/api/admin/logout` | — | clears cookie |
| `/api/admin/reindex` | — | `{ added, removed, duplicates }` |
| `/api/admin/upload` | `multipart` (files + label) | `{ inserted, duplicates, errors }` |
| `/api/admin/images` | `{ id, action }` where action ∈ `retire`/`reactivate`/`delete` | `{ ok }` |

`GET /api/admin/images?label=&page=` feeds the gallery; `GET /api/admin/elo`
feeds the ELO view (two sorted arrays, already shaped for two columns).

### Views

**`/admin` (gallery):** filterable grid (all/ai/real), each tile shows
thumbnail + label + ELO + appearances + truncated SHA1. Row actions:
retire / reactivate / delete. Upload dropzone at top (label selector +
multi-file). 25 MB/file cap (stress note #6).

**`/admin/elo`:** two columns (AI | Real), each a vertical strip of small
thumbnails sorted by ELO desc. Click → jump to gallery filtered to that
image.

Thumbnails are served through the same opaque `/api/img/[id]` endpoint and
browser-scaled (stress note #8).

---

## Feature 4 — SHA1 hashing & dedup

- SHA1 computed once at index time over raw bytes (FS) or via the ETag
  fast-path (S3) — stress note #5.
- `images.sha1` is `UNIQUE`. Duplicate upload or same object under both
  prefixes → one row. First label seen wins; the conflict is reported in the
  indexer's `duplicates` list (the "same photo in both folders" case is a
  real tell worth surfacing to the operator).
- Opaque public id becomes `HMAC-SHA256(sha1)[:24]` — stable across
  renames/source moves. Backwards-incompatible vs today's HMAC-of-path, but
  image ids are never persisted by clients (rounds are short-lived signed
  tokens), so no external migration.

---

## Data model

Additive — the existing `scores` table is untouched.

```ts
// src/db/schema.ts (additions)
export const images = sqliteTable("images", {
  id: text("id").primaryKey(),            // HMAC-SHA256(sha1)[:24]
  sha1: text("sha1").notNull().unique(),  // content hash; dedup key
  label: text("label", { enum: ["ai", "real"] }).notNull(),
  source: text("source", { enum: ["fs", "s3"] }).notNull(),
  locator: text("locator").notNull(),     // abs path | "bucket/key"
  ext: text("ext").notNull(),
  mime: text("mime").notNull(),
  elo: integer("elo").notNull().default(1000),
  appearances: integer("appearances").notNull().default(0),
  fools: integer("fools").notNull().default(0),
  retired: integer("retired", { mode: "boolean" }).notNull().default(false),
  indexedAt: integer("indexed_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
```

`retired` is a manual operator flag only — automatic retirement by ELO floor
is a **runtime check** in `pickByLabel`, never persisted, so an image's ELO
can recover if the threshold changes. Indexes: unique `sha1`, `(label,
retired)` for round selection, `(label, elo)` for the ELO view.

### Catalog refactor

`src/lib/catalog.ts` becomes DB-backed but keeps the in-memory cache
(stress note #1):

- `getEntry(id)` → cache lookup, fall back to `images` row.
- `pickByLabel(label, excludeId?)` → random pick from the in-memory array
  for that label (minus retired/under-floor, with empty-pool fallback).
- `reindex()` / `upload()` / `deleteImage()` / `retireImage()` → write the
  row, then `reloadCache()` (one `SELECT *` per label). Hot path untouched.
- One-time migration on first boot: scan `images/{ai,real}/` exactly as
  today, SHA1 each file, populate the table. Existing local deploys keep
  working with zero operator action.

```bash
npm run db:generate   # picks up the new table
npm run db:migrate    # already runs on boot via ensureSchema()
```

---

## Acceptance criteria

- [ ] No S3 env vars → app behaves as today (FS source, same proxy contract
      modulo the id derivation).
- [ ] S3 env vars set + `POST /api/admin/reindex` → library populated from
      S3, game serves those images through `/api/img/[id]`, no source leak.
- [ ] Same file uploaded/scanned twice → no duplicate row, response reports
      `duplicates`.
- [ ] After N guesses, each image's `elo`/`appearances`/`fools` move in the
      documented direction; below `ROA_ELO_RETIRE_BELOW` stops appearing —
      unless that would empty the pool.
- [ ] `/admin` 404s when `ROA_ADMIN_PASSWORD` unset; with it set, login →
      gallery (with upload) → elo flow works; unauthed `/api/admin/*` → 401.
- [ ] Existing game/leaderboard tests still pass; new tests cover ELO math,
      the atomic update, dedup, and the empty-pool fallback.

---

## Rollout

Each slice ships on its own behind env toggles:

1. **DB-backed catalog + SHA1 + FS migration + in-memory cache.** No
   user-visible change; catalog reads from `images`. Prereq for the rest.
2. **S3 source + indexer + reindex route** (admin-gated from the start).
3. **ELO tracking** — outcome extraction + atomic update in
   `POST /api/game/guess`; retirement filter + fallback in `pickByLabel`.
4. **Admin portal UI** — login, gallery + upload, ELO view.
