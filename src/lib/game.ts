import "server-only";
import type { Mode, RoundResponse, Verdict } from "./types";
import type { CatalogEntry } from "./types";
import { pickByLabel } from "./catalog";
import { sign, verify } from "./crypto";

interface RoundTokenPayload {
  l: string; // left image id
  r: string; // right image id
  t: Verdict; // truth (which side is AI)
  m: Mode;
  ts: number;
}

/** 50/50: left is AI or right is AI. Exactly one of each per round. */
export function rollTruth(): Verdict {
  return Math.random() < 0.5 ? "left" : "right";
}

export interface BuiltRound {
  response: RoundResponse;
  truth: Verdict;
  left: CatalogEntry;
  right: CatalogEntry;
}

/**
 * Map a round truth (which side is AI) to a single side's true label.
 * With exactly-one-AI-per-round, this is trivial: the truth side is AI,
 * the other is real.
 */
export function labelForSide(
  truth: Verdict,
  side: "left" | "right",
): "ai" | "real" {
  return truth === side ? "ai" : "real";
}

/**
 * Build a round with exactly one AI and one real image, excluding any IDs
 * already shown this game (seenIds). Returns null if either pool is empty.
 */
export async function buildRound(
  mode: Mode,
  seenIds?: Set<string>,
): Promise<BuiltRound | null> {
  const truth = rollTruth();

  // Pick the AI image and the real image, both excluding seenIds.
  const aiEntry = await pickByLabel("ai", seenIds);
  if (!aiEntry) return null;
  const realEntry = await pickByLabel("real", seenIds);
  if (!realEntry) return null;

  // Assign sides based on truth: the truth side gets the AI image.
  const left = truth === "left" ? aiEntry : realEntry;
  const right = truth === "left" ? realEntry : aiEntry;

  const payload: RoundTokenPayload = {
    l: left.id,
    r: right.id,
    t: truth,
    m: mode,
    ts: Date.now(),
  };

  return {
    truth,
    left,
    right,
    response: {
      leftId: left.id,
      rightId: right.id,
      token: sign(payload),
      mode,
    },
  };
}

export function decodeToken(token: string): RoundTokenPayload | null {
  return verify<RoundTokenPayload>(token);
}
