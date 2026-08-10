import { describe, expect, it } from "vitest";
import { rateLimit, getClientIp } from "./rate-limit";

describe("rate-limit", () => {
  describe("rateLimit", () => {
    it("allows up to capacity requests in a burst", () => {
      const cfg = { capacity: 3, perHour: 10, prefix: "test-burst" };
      expect(rateLimit("1.2.3.4", cfg).allowed).toBe(true);
      expect(rateLimit("1.2.3.4", cfg).allowed).toBe(true);
      expect(rateLimit("1.2.3.4", cfg).allowed).toBe(true);
      expect(rateLimit("1.2.3.4", cfg).allowed).toBe(false);
    });

    it("isolates by IP", () => {
      const cfg = { capacity: 1, perHour: 10, prefix: "test-iso" };
      expect(rateLimit("1.1.1.1", cfg).allowed).toBe(true);
      expect(rateLimit("2.2.2.2", cfg).allowed).toBe(true);
      expect(rateLimit("1.1.1.1", cfg).allowed).toBe(false);
      expect(rateLimit("2.2.2.2", cfg).allowed).toBe(false);
    });

    it("isolates by prefix (different limits don't collide)", () => {
      const a = { capacity: 1, perHour: 10, prefix: "A" };
      const b = { capacity: 1, perHour: 10, prefix: "B" };
      expect(rateLimit("9.9.9.9", a).allowed).toBe(true);
      expect(rateLimit("9.9.9.9", a).allowed).toBe(false);
      // Same IP, different prefix = fresh bucket
      expect(rateLimit("9.9.9.9", b).allowed).toBe(true);
    });

    it("reports remaining tokens", () => {
      const cfg = { capacity: 3, perHour: 10, prefix: "test-rem" };
      expect(rateLimit("5.5.5.5", cfg).remaining).toBe(2);
      expect(rateLimit("5.5.5.5", cfg).remaining).toBe(1);
      expect(rateLimit("5.5.5.5", cfg).remaining).toBe(0);
      const blocked = rateLimit("5.5.5.5", cfg);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
    });
  });

  describe("getClientIp", () => {
    it("reads x-forwarded-for (first IP)", () => {
      const req = new Request("https://x/", {
        headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      });
      expect(getClientIp(req)).toBe("1.2.3.4");
    });

    it("reads x-real-ip as fallback", () => {
      const req = new Request("https://x/", {
        headers: { "x-real-ip": "9.9.9.9" },
      });
      expect(getClientIp(req)).toBe("9.9.9.9");
    });

    it("returns 'unknown' when no headers present", () => {
      const req = new Request("https://x/");
      expect(getClientIp(req)).toBe("unknown");
    });

    it("prefers x-forwarded-for over x-real-ip", () => {
      const req = new Request("https://x/", {
        headers: {
          "x-forwarded-for": "1.1.1.1",
          "x-real-ip": "2.2.2.2",
        },
      });
      expect(getClientIp(req)).toBe("1.1.1.1");
    });
  });
});
