# Core rules for AI-or-Not

Follow these on every change. Violations block merge.

## 1. Verify before claiming

- Read the file before editing it. Read `node_modules/next/dist/docs/` before
  touching Next.js APIs — this is Next.js 16, not the version in your training
  data, and it has breaking changes.
- Run `npm run lint && npm run build && npm test` before declaring a task done.
  "Should work" is not "works".
- If you assume an API exists, say so and check it. Do not fabricate function
  signatures, env var names, or file paths.

## 2. The source-hidden proxy is the core invariant

Images served to the client must not reveal whether they came from
`images/ai/` or `images/real/`. Enforced via:

- HMAC-derived opaque IDs (`src/lib/crypto.ts` → `opaqueId`)
- Server-side file reading in `src/app/api/img/[id]/route.ts`
- No `Content-Disposition` filename that echoes the source path

If a change would leak the label, reject it.

## 3. Server-side score tracking is the trust boundary

The client does not self-report scores. The flow is:

1. `POST /api/game/start` → server issues a game-token, creates a
   `GameState { correct: 0, total: 0, mode }` keyed by token.
2. `POST /api/game/guess` `{ roundToken, guess, gameToken }` → server verifies
   the round token, checks correctness, increments `GameState.correct`.
3. `POST /api/leaderboard` `{ gameToken }` → server reads `GameState`, persists
   the score. The request body's `correct`/`total` are ignored.

Do not add a path that lets the client specify its own score.

## 4. Conventional Commits

This repo uses release-please. Commit prefixes determine semver bumps:

- `feat:` → minor
- `fix:`, `perf:` → patch
- `feat!:` or `BREAKING CHANGE:` footer → major
- `chore:`, `docs:`, `test:`, `ci:`, `refactor:` → no release

Use the right prefix. A `chore:` that ships a feature silently skips release.

## 5. Dependencies

- No new runtime dependency without justification in the commit message.
- Action versions in `.github/workflows/` must track latest majors. The
  `ai-workflows` caller pins are `@v0.2.7` — bump only via the propagate
  workflow, not by hand.
- `server-only` guards server-exclusive modules (`db/`, `lib/catalog.ts`,
  `lib/leaderboard.ts`).

## 6. TypeScript discipline

- `strict: true` is on. No `any` without an inline `// eslint-disable-next-line`
  and a comment explaining why.
- Validate all API input with Zod schemas in `src/lib/schemas.ts`. Do not
  hand-roll `typeof` checks in route handlers.

## 7. Zero tech debt

- Delete dead code. If you remove a function, remove its exports and tests.
- If you find a bug while working on something else, file an issue — don't
  silently fix it in an unrelated commit.
- Don't add comments that paraphrase the code. Add comments for *why*,
  especially around the crypto and trust-boundary logic.
