import { describe, expect, it, vi } from "vitest";

// Mock the catalog so buildRound doesn't depend on the filesystem.
let counter = 0;
const make = (label: "ai" | "real") => ({
  id: `${label}-${++counter}`,
  absPath: `/images/${label}/${counter}.jpg`,
  ext: ".jpg",
  mime: "image/jpeg",
  label,
});
vi.mock("./catalog", () => ({
  getCounts: async () => ({ ai: 4, real: 4 }),
  pickByLabel: async (label: "ai" | "real") => make(label),
}));

// Import AFTER the mock is registered.
import { rollTruth, buildRound, decodeToken } from "./game";

describe("game logic", () => {
  describe("rollTruth", () => {
    it("returns one of the four valid verdicts", () => {
      for (let i = 0; i < 100; i++) {
        const t = rollTruth();
        expect(["left", "right", "both", "none"]).toContain(t);
      }
    });

    it("produces all four outcomes over many rolls (sanity)", () => {
      const counts: Record<string, number> = {
        left: 0,
        right: 0,
        both: 0,
        none: 0,
      };
      for (let i = 0; i < 4000; i++) {
        counts[rollTruth()]++;
      }
      // left and right should each be ~40%, both and none ~10%. Allow wide
      // tolerance — this is a sanity check, not a statistical assertion.
      expect(counts.left).toBeGreaterThan(1000);
      expect(counts.right).toBeGreaterThan(1000);
      expect(counts.both).toBeGreaterThan(100);
      expect(counts.none).toBeGreaterThan(100);
    });
  });

  describe("buildRound", () => {
    it("returns a round with two opaque IDs and a signed token", async () => {
      const built = await buildRound("easy");
      expect(built).not.toBeNull();
      if (!built) return;
      const { response, truth } = built;
      expect(response.leftId).toMatch(/^(ai|real)-/);
      expect(response.rightId).toMatch(/^(ai|real)-/);
      expect(response.mode).toBe("easy");
      expect(["left", "right", "both", "none"]).toContain(truth);
    });

    it("encodes the truth in the token, readable only via decodeToken", async () => {
      const built = await buildRound("hard");
      if (!built) throw new Error("buildRound returned null");
      const decoded = decodeToken(built.response.token);
      expect(decoded).not.toBeNull();
      expect(decoded!.t).toBe(built.truth);
      expect(decoded!.m).toBe("hard");
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
