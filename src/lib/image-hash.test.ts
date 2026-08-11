import { describe, expect, it } from "vitest";
import { sha1Hex, imageIdFromSha1 } from "./image-hash";

describe("sha1Hex", () => {
  it("matches a known SHA1 vector", () => {
    // sha1("") = da39a3ee5e6b4b0d3255bfef95601890afd80709
    expect(sha1Hex(Buffer.alloc(0))).toBe(
      "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    );
  });

  it("matches sha1('hello')", () => {
    // sha1("hello") = aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
    expect(sha1Hex(Buffer.from("hello", "utf8"))).toBe(
      "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
    );
  });

  it("is deterministic", () => {
    const a = sha1Hex(Buffer.from("same"));
    const b = sha1Hex(Buffer.from("same"));
    expect(a).toBe(b);
  });

  it("differs for different content", () => {
    expect(sha1Hex(Buffer.from("a"))).not.toBe(sha1Hex(Buffer.from("b")));
  });

  it("accepts Uint8Array", () => {
    const u8 = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    expect(sha1Hex(u8)).toBe("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
  });
});

describe("imageIdFromSha1", () => {
  it("returns a 24-char hex id", () => {
    const id = imageIdFromSha1("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
    expect(id).toMatch(/^[0-9a-f]{24}$/);
  });

  it("is stable for the same SHA1", () => {
    const sha = "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d";
    expect(imageIdFromSha1(sha)).toBe(imageIdFromSha1(sha));
  });

  it("differs for different SHA1s (different content)", () => {
    const a = imageIdFromSha1(
      "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
    );
    const b = imageIdFromSha1(
      "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    );
    expect(a).not.toBe(b);
  });
});
