import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { images } from "@/db/schema";
import { refreshEntryInCache } from "./catalog";

/**
 * Per-image ELO. The image "wins" an appearance by fooling the player; the
 * player "wins" by classifying it correctly. Standard Elo against a fixed
 * population baseline (no player-skill tracking — non-goal; see design doc).
 */

const K_FACTOR = 32;
const POPULATION_RATING = 1000;
const ELO_FLOOR = 100;

export type Side = "left" | "right";
/**
 * The player's pick. With the issue-#18 redesign, this is always "left" or
 * "right" — the wider union is kept for the function's test matrix and as
 * a safety net in case ambiguous verdicts are re-added behind a config.
 */
export type Guess = "left" | "right" | "both" | "none";
export type ImageLabel = "ai" | "real";

/** Expected score for the image (1 = image wins, 0 = player wins). Pure. */
export function expectedScore(imageElo: number): number {
  return 1 / (1 + 10 ** ((POPULATION_RATING - imageElo) / 400));
}

/** Signed ELO delta for the image after one appearance. Pure. */
export function eloDelta(imageElo: number, fooled: boolean): number {
  const expected = expectedScore(imageElo);
  const actual = fooled ? 1 : 0;
  return K_FACTOR * (actual - expected);
}

/**
 * Did this image fool the player on this appearance? Derived from the
 * player's verdict and the image's true label + side.
 *
 * The player's verdict answers "which side(s) are AI?":
 *   left / right / both / none
 *
 * For an AI image, the player "catches" it iff they flagged its side as AI
 * (or said "both"). For a real image, the player is correct iff they did
 * NOT flag its side as AI (i.e. said the opposite side or "none").
 *
 * The image "fools" the player when the player is wrong.
 */
export function imageFooledPlayer(
  label: ImageLabel,
  side: Side,
  guess: Guess,
): boolean {
  const flaggedThisSide = guess === "both" || guess === side;
  if (label === "ai") {
    // AI image: player should have flagged it. Fooled = they didn't.
    return !flaggedThisSide;
  }
  // Real image: player should NOT have flagged it. Fooled = they did.
  return flaggedThisSide;
}

/**
 * Atomic appearance update. Single SQL statement — the ELO delta is computed
 * against the row's current elo via SQL math, so concurrent updates never
 * race (each UPDATE locks the row and reads/writes atomically). SQLite has
 * `power()` (SQL standard) but not `pow()`. Stress note #2.
 *
 * The expression: `MAX(100, elo + 32 * (actual - expected(elo)))` where
 * `expected(elo) = 1 / (1 + 10^((1000 - elo) / 400))`.
 *
 * After the write, the in-memory catalog entry is refreshed so the new elo
 * is visible to pickByLabel() immediately — without this, an image that
 * drops below ROA_ELO_RETIRE_BELOW keeps being served from stale cache
 * until a manual reindex. The refresh is one extra SELECT, far cheaper
 * than the full reloadCache().
 */
export async function recordAppearance(
  imageId: string,
  fooled: boolean,
): Promise<void> {
  const actual = fooled ? 1 : 0;
  await db
    .update(images)
    .set({
      elo: sql`MAX(${ELO_FLOOR}, ${images.elo} + ${K_FACTOR} * (${actual} - (1.0 / (1.0 + power(10.0, (${POPULATION_RATING} - ${images.elo}) / 400.0)))))`,
      appearances: sql`${images.appearances} + 1`,
      fools: sql`${images.fools} + ${actual}`,
      updatedAt: Date.now(),
    })
    .where(sql`${images.id} = ${imageId}`);
  await refreshEntryInCache(imageId);
}

export const _ELO_CONSTANTS = { K_FACTOR, POPULATION_RATING, ELO_FLOOR };
