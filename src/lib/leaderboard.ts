import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db";
import { scores } from "@/db/schema";
import type {
  Bucket,
  LeaderboardEntry,
  LeaderboardPreview,
  ScoreStats,
} from "./types";
import type { GameState } from "./game-store";

function buildBuckets(rows: { score: number }[]): Bucket[] {
  const buckets: Bucket[] = [];
  for (let i = 0; i < 10; i++) {
    buckets.push({ lo: i * 10, hi: i * 10 + 10, count: 0 });
  }
  for (const r of rows) {
    const idx = Math.min(9, Math.floor(r.score / 10));
    buckets[idx].count++;
  }
  return buckets;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function submitScore(
  game: GameState,
): Promise<ScoreStats> {
  await ensureSchema();
  const total = Math.max(1, game.total);
  const correct = Math.min(total, Math.max(0, game.correct));
  const score = Math.round((correct / total) * 100);

  await db.insert(scores).values({
    score,
    correct,
    total,
    mode: game.mode,
  });

  const peers = await db
    .select({ score: scores.score })
    .from(scores)
    .where(eq(scores.mode, game.mode));

  const peerScores = peers.map((p) => p.score);
  const higher = peerScores.filter((s) => s > score).length;
  const equal = peerScores.filter((s) => s === score).length;
  const lower = peerScores.filter((s) => s < score).length;
  const peerCount = peers.length;
  const mean =
    peerCount === 0
      ? 0
      : Math.round(
          (peerScores.reduce((a, b) => a + b, 0) / peerCount) * 10,
        ) / 10;

  return {
    total: peerCount,
    rank: higher + 1,
    tiedWith: equal - 1,
    percentile:
      peerCount === 0
        ? 100
        : Math.round((lower / peerCount) * 1000) / 10,
    mean,
    median: Math.round(median(peerScores) * 10) / 10,
    yourScore: score,
    distribution: buildBuckets(peers),
  };
}

export async function getPreview(): Promise<LeaderboardPreview> {
  await ensureSchema();
  const all = await db.select().from(scores);
  const top = [...all]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map<LeaderboardEntry>((r) => ({
      score: r.score,
      correct: r.correct,
      total: r.total,
      mode: r.mode,
      ts: r.createdAt,
    }));
  const meanScore =
    all.length === 0
      ? 0
      : Math.round(
          (all.reduce((a, e) => a + e.score, 0) / all.length) * 10,
        ) / 10;
  return { totalGames: all.length, meanScore, top };
}
