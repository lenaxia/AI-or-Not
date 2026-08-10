import { describe, expect, it } from "vitest";
import { hmacHex, opaqueId, sign, verify } from "./crypto";

describe("crypto", () => {
  describe("hmacHex", () => {
    it("is deterministic for the same input", () => {
      expect(hmacHex("foo")).toBe(hmacHex("foo"));
    });

    it("differs for different inputs", () => {
      expect(hmacHex("foo")).not.toBe(hmacHex("bar"));
    });
  });

  describe("opaqueId", () => {
    it("returns a 24-char hex prefix", () => {
      const id = opaqueId("images/ai/foo.jpg");
      expect(id).toMatch(/^[0-9a-f]{24}$/);
    });

    it("is stable for the same path", () => {
      expect(opaqueId("images/ai/foo.jpg")).toBe(opaqueId("images/ai/foo.jpg"));
    });

    it("differs for ai vs real of the same filename", () => {
      expect(opaqueId("images/ai/foo.jpg")).not.toBe(
        opaqueId("images/real/foo.jpg"),
      );
    });
  });

  describe("sign / verify", () => {
    it("round-trips a payload", () => {
      const payload = { a: 1, b: "two", nested: { c: true } };
      const token = sign(payload);
      expect(verify(token)).toEqual(payload);
    });

    it("returns null for a tampered payload", () => {
      const token = sign({ a: 1 });
      const [body, mac] = token.split(".");
      // Flip a character in the body
      const tampered = body!.replace(/^./, "X") + "." + mac;
      expect(verify(tampered)).toBeNull();
    });

    it("returns null for a tampered MAC", () => {
      const token = sign({ a: 1 });
      const [body, mac] = token.split(".");
      const tampered = body + "." + "0".repeat(mac!.length);
      expect(verify(tampered)).toBeNull();
    });

    it("returns null for a malformed token", () => {
      expect(verify("not-a-token")).toBeNull();
      expect(verify("")).toBeNull();
      expect(verify("a.b.c")).toBeNull();
    });

    it("returns null when the body is not valid JSON", () => {
      // Manually craft a token with valid MAC format but garbage body.
      // verify will fail JSON.parse.
      const token = "notbase64." + "a".repeat(32);
      expect(verify(token)).toBeNull();
    });

    it("handles unicode payloads", () => {
      const payload = { emoji: "🎨", path: "images/ai/ üñîcödé.jpg" };
      const token = sign(payload);
      expect(verify(token)).toEqual(payload);
    });
  });
});
