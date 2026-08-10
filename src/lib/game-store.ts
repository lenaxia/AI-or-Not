import "server-only";
import { randomBytes } from "node:crypto";
import type { Mode } from "./types";
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
 * SINGLE-INSTANCE ONLY. For multi-instance deploys (Kubernetes with >1
 * replica, serverless), replace this with Redis or a shared DB table.
 * The interface (start/guess/finish/expire) maps cleanly to a KV store.
 */

const GAME_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export interface GameState {
  id: string;
  mode: Mode;
  correct: number;
  total: number;
  startedAt: number;
  expiresAt: number;
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
 * Record a guess. Call only after the round token has been verified.
 * Returns the updated state, or null if the game token is invalid.
 */
export function recordGuess(
  gameToken: string,
  correct: boolean,
): GameState | null {
  const state = resolveGame(gameToken);
  if (!state) return null;
  state.total += 1;
  if (correct) state.correct += 1;
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
