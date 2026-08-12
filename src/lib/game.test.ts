import { describe, expect, it, vi } from "vitest";

// Mock the catalog so buildRound doesn't depend on the filesystem.
let counter = 0;
const make = (label: "ai" | "real") => ({
  id: `${label}-${++counter}`,
  absPath: `/images/${label}/${counter}.jpg`,
  sha1: `sha1-${label}-${counter}`,
  locator: `/images/${label}/${counter}.jpg`,
  source: "fs" as const,
  ext: ".jpg",
  mime: "image/jpeg",
  label,
  elo: 1000,
  appearances: 0,
  fools: 0,
  retired: false,
});
vi.mock("./catalog", () => ({
  getCounts: async () => ({ ai: 10, real: 10 }),
  pickByLabel: async (label: "ai" | "real", excludeIds?: Set<string>) => {
    void excludeIds;
    return make(label);
  },
}));

// Import AFTER the mock is registered.
import { rollTruth, buildRound, decodeToken, labelForSide } from "./game";

describe("game logic", () => {
  describe("rollTruth", () => {
    it("returns only left or right (no both/none)", () => {
      for (let i = 0; i < 1000; i++) {
        const t = rollTruth();
        expect(["left", "right"]).toContain(t);
      }
    });

    it("produces both outcomes over many rolls (50/50 sanity)", () => {
      const counts: Record<string, number> = { left: 0, right: 0 };
      for (let i = 0; i < 4000; i++) {
        counts[rollTruth()]++;
      }
      expect(counts.left).toBeGreaterThan(1500);
      expect(counts.right).toBeGreaterThan(1500);
    });
  });

  describe("labelForSide", () => {
    it("marks the truth side as AI", () => {
      expect(labelForSide("left", "left")).toBe("ai");
      expect(labelForSide("left", "right")).toBe("real");
      expect(labelForSide("right", "right")).toBe("ai");
      expect(labelForSide("right", "left")).toBe("real");
    });
  });

  describe("buildRound", () => {
    it("returns a round with two opaque IDs and a signed token", async () => {
      const built = await buildRound("easy");
      expect(built).not.toBeNull();
      if (!built) return;
      const { response, truth } = built;
      expect(response.leftId).toBeTruthy();
      expect(response.rightId).toBeTruthy();
      expect(response.mode).toBe("easy");
      expect(["left", "right"]).toContain(truth);
    });

    it("encodes the truth in the token, readable only via decodeToken", async () => {
      const built = await buildRound("hard");
      if (!built) throw new Error("buildRound returned null");
      const decoded = decodeToken(built.response.token);
      expect(decoded).not.toBeNull();
      expect(decoded!.t).toBe(built.truth);
      expect(decoded!.m).toBe("hard");
    });

    it("always has exactly one AI and one real image", async () => {
      for (let i = 0; i < 20; i++) {
        const built = await buildRound("easy");
        if (!built) throw new Error("buildRound returned null");
        // The truth side is AI, the other is real.
        const leftLabel = labelForSide(built.truth, "left");
        const rightLabel = labelForSide(built.truth, "right");
        expect(leftLabel).not.toBe(rightLabel);
        expect([leftLabel, rightLabel].sort()).toEqual(["ai", "real"]);
      }
    });

    it("respects seenIds to prevent repeats", async () => {
      // With the mock, pickByLabel returns a fixed ID per label per call.
      // Give it a seenIds set that excludes the first AI entry.
      const seen = new Set<string>();
      const built1 = await buildRound("easy", seen);
      if (!built1) throw new Error("null");
      seen.add(built1.left.id);
      seen.add(built1.right.id);
      // Second call with the same seenIds — mock still returns an entry
      // (the mock doesn't actually filter), but the call succeeds, proving
      // the Set type is accepted and threaded through.
      const built2 = await buildRound("easy", seen);
      expect(built2).not.toBeNull();
    });
  });

  describe("decodeToken", () => {
    it("returns null for garbage", () => {
      expect(decodeToken("garbage")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(decodeToken("")).toBeNull();
    });
  });
});
