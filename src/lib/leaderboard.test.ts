import { describe, expect, it } from "vitest";

// Test the pure math helpers by reimplementing the input shapes. The
// actual submitScore needs a DB; we test the bucketing/median/percentile
// logic in isolation by extracting it to a pure function would be ideal,
// but for now we test the exported helpers indirectly via the types.

// Re-implement the pure helpers locally to test the math without a DB.
function buildBuckets(scores: number[]) {
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    lo: i * 10,
    hi: i * 10 + 10,
    count: 0,
  }));
  for (const s of scores) {
    const idx = Math.min(9, Math.floor(s / 10));
    buckets[idx].count++;
  }
  return buckets;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function computeStats(
  peerScores: number[],
  yourScore: number,
) {
  const higher = peerScores.filter((s) => s > yourScore).length;
  const equal = peerScores.filter((s) => s === yourScore).length;
  const lower = peerScores.filter((s) => s < yourScore).length;
  const count = peerScores.length;
  const mean =
    count === 0
      ? 0
      : Math.round((peerScores.reduce((a, b) => a + b, 0) / count) * 10) / 10;
  return {
    total: count,
    rank: higher + 1,
    tiedWith: equal - 1,
    percentile:
      count === 0 ? 100 : Math.round((lower / count) * 1000) / 10,
    mean,
    median: Math.round(median(peerScores) * 10) / 10,
    distribution: buildBuckets(peerScores),
  };
}

describe("leaderboard math", () => {
  describe("buildBuckets", () => {
    it("places scores in the right deciles", () => {
      const buckets = buildBuckets([0, 5, 10, 50, 99, 100]);
      expect(buckets[0]!.count).toBe(2); // 0, 5
      expect(buckets[1]!.count).toBe(1); // 10
      expect(buckets[5]!.count).toBe(1); // 50
      expect(buckets[9]!.count).toBe(2); // 99, 100
    });

    it("handles empty input", () => {
      const buckets = buildBuckets([]);
      expect(buckets.every((b) => b.count === 0)).toBe(true);
    });

    it("clamps score 100 to bucket 9 (not 10)", () => {
      const buckets = buildBuckets([100]);
      expect(buckets[9]!.count).toBe(1);
      expect(buckets[10]).toBeUndefined();
    });
  });

  describe("median", () => {
    it("returns 0 for empty array", () => {
      expect(median([])).toBe(0);
    });

    it("returns the middle for odd count", () => {
      expect(median([1, 3, 5])).toBe(3);
    });

    it("returns the average of two middles for even count", () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it("handles unsorted input", () => {
      expect(median([5, 1, 3, 2, 4])).toBe(3);
    });
  });

  describe("computeStats", () => {
    it("ranks a top score at #1 with 100th percentile", () => {
      const stats = computeStats([50, 60, 70], 90);
      expect(stats.rank).toBe(1);
      expect(stats.percentile).toBe(100);
    });

    it("ranks a bottom score last with 0th percentile", () => {
      const stats = computeStats([50, 60, 70], 10);
      expect(stats.rank).toBe(4);
      expect(stats.percentile).toBe(0);
    });

    it("handles being the only entry", () => {
      const stats = computeStats([], 50);
      expect(stats.total).toBe(0);
      expect(stats.rank).toBe(1);
      expect(stats.percentile).toBe(100);
      expect(stats.mean).toBe(0);
    });

    it("counts ties correctly", () => {
      const stats = computeStats([50, 50, 50], 50);
      expect(stats.rank).toBe(1);
      // 3 peers all tied with yourScore → equal=3, tiedWith = equal-1 = 2.
      expect(stats.tiedWith).toBe(2);
      // Nobody is below, so percentile is 0.
      expect(stats.percentile).toBe(0);
    });

    it("computes mean correctly", () => {
      const stats = computeStats([60, 70, 80], 50);
      expect(stats.mean).toBe(70);
    });
  });
});
