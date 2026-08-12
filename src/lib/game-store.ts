import "server-only";
import { randomBytes } from "node:crypto";
import type { Mode, Verdict } from "./types";
import { sign, verify } from "./crypto";

/**
 * In-memory game session store.
 *
 * Tracks per-game correct-guess counts server-side so the client cannot
 * self-report a score to the leaderboard. A game token (HMAC-signed) is
 * issued at game start; each guess increments the server's counter; the
 * leaderboard submission reads from this store and ignores any client-
 * supplied score.
 *
 * Also tracks seenIds (for within-session dedup) and the full round+guess
 * history (for the end-of-game review gallery).
 *
 * SINGLE-INSTANCE ONLY. For multi-instance deploys (Kubernetes with >1
 * replica, serverless), replace this with Redis or a shared DB table.
 * The interface (start/guess/finish/expire) maps cleanly to a KV store.
 */

const GAME_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export interface RoundRecord {
  leftId: string;
  rightId: string;
  truth: Verdict;
}

export interface GuessRecord {
  guess: Verdict;
  correct: boolean;
}

export interface GameState {
  id: string;
  mode: Mode;
  correct: number;
  total: number;
  startedAt: number;
  expiresAt: number;
  /** Image IDs already shown this game — prevents repeats within a session. */
  seenIds: Set<string>;
  /** Per-round truth + image IDs, appended on each /api/game/round call. */
  rounds: RoundRecord[];
  /** Per-guess records, appended on each /api/game/guess call. */
  guesses: GuessRecord[];
}

interface GameTokenPayload {
  id: string;
  mode: Mode;
  startedAt: number;
}

const store = new Map<string, GameState>();

// Periodic cleanup of expired games.
let cleanupStarted = false;
function startCleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, state] of store) {
      if (state.expiresAt <= now) store.delete(id);
    }
  }, CLEANUP_INTERVAL_MS).unref();
}

export function startGame(mode: Mode): { gameToken: string; state: GameState } {
  startCleanup();
  const now = Date.now();
  const id = randomBytes(16).toString("hex");
  const state: GameState = {
    id,
    mode,
    correct: 0,
    total: 0,
    startedAt: now,
    expiresAt: now + GAME_TTL_MS,
    seenIds: new Set(),
    rounds: [],
    guesses: [],
  };
  store.set(id, state);
  const payload: GameTokenPayload = {
    id,
    mode,
    startedAt: now,
  };
  return { gameToken: sign(payload), state };
}

/**
 * Validate a game token and return the associated state.
 * Returns null if the token is invalid, tampered, expired, or unknown.
 */
export function resolveGame(gameToken: string): GameState | null {
  const payload = verify<GameTokenPayload>(gameToken);
  if (!payload) return null;
  const state = store.get(payload.id);
  if (!state) return null;
  if (state.expiresAt <= Date.now()) {
    store.delete(payload.id);
    return null;
  }
  return state;
}

/**
 * Record a round's image IDs + truth. Called by /api/game/round after
 * buildRound succeeds, so the server remembers the truth for the review
 * gallery and can dedup future rounds.
 */
export function recordRound(
  gameToken: string,
  round: RoundRecord,
): GameState | null {
  const state = resolveGame(gameToken);
  if (!state) return null;
  state.rounds.push(round);
  state.seenIds.add(round.leftId);
  state.seenIds.add(round.rightId);
  return state;
}

/**
 * Record a guess. Call only after the round token has been verified.
 * Stores the guess for the review gallery and increments the score tally.
 */
export function recordGuess(
  gameToken: string,
  guess: Verdict,
  correct: boolean,
): GameState | null {
  const state = resolveGame(gameToken);
  if (!state) return null;
  state.total += 1;
  if (correct) state.correct += 1;
  state.guesses.push({ guess, correct });
  return state;
}

/**
 * Consume the game: read and delete the state. Called by the leaderboard
 * submission endpoint so a game token can only be cashed in once.
 */
export function consumeGame(gameToken: string): GameState | null {
  const state = resolveGame(gameToken);
  if (!state) return null;
  store.delete(state.id);
  return state;
}
