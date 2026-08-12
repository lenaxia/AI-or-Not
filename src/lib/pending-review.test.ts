import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

const mem = createClient({ url: "file::memory:?cache=shared" });
const memDb = drizzle(mem, { schema });

vi.mock("@/db", () => ({ db: memDb, ensureSchema: async () => {} }));

// --- S3 mock: a flat key → bytes store with list/copy/delete ----------------
// Unlike catalog-s3.test.ts, this mock models copy + delete so we can assert
// the accept (copy-then-delete) and reject (delete) side effects.
interface S3Obj {
  bytes: Buffer;
  etag: string;
}
const s3Store: Record<string, S3Obj> = {};
const s3CopyLog: Array<{ src: string; dst: string }> = [];
const s3DeleteLog: string[] = [];
const s3ListCalls: Array<{ prefix: string; limit?: number }> = [];

vi.mock("./s3", () => ({
  s3Enabled: () => !!process.env.ROA_S3_BUCKET,
  listS3Images: async (prefix: string, opts?: { limit?: number }) => {
    s3ListCalls.push({ prefix, limit: opts?.limit });
    const out: Array<{ key: string; ext: string; mime: string; etag: string; size: number }> = [];
    for (const [key, obj] of Object.entries(s3Store)) {
      if (!key.startsWith(prefix)) continue;
      const slash = key.lastIndexOf("/");
      const name = slash >= 0 ? key.slice(slash + 1) : key;
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
      const mime = { ".jpg": "image/jpeg", ".png": "image/png" }[ext];
      if (!mime) continue;
      out.push({ key, ext, mime, etag: obj.etag, size: obj.bytes.length });
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return opts?.limit ? out.slice(0, opts.limit) : out;
  },
  getS3Object: async (key: string) => {
    const obj = s3Store[key];
    if (!obj) throw new Error(`mock: no object for ${key}`);
    return obj.bytes;
  },
  copyS3Object: async (src: string, dst: string) => {
    const obj = s3Store[src];
    if (!obj) throw new Error(`mock: no source for copy ${src}`);
    s3Store[dst] = { ...obj };
    s3CopyLog.push({ src, dst });
  },
  deleteS3Object: async (key: string) => {
    delete s3Store[key];
    s3DeleteLog.push(key);
  },
  s3Locator: (bucket: string, key: string) => `${bucket}/${key}`,
  parseLocator: (locator: string) => {
    const slash = locator.indexOf("/");
    return { bucket: locator.slice(0, slash), key: locator.slice(slash + 1) };
  },
}));

let tmpDir: string;

beforeEach(async () => {
  await mem.batch([
    "DROP TABLE IF EXISTS images",
    `CREATE TABLE images (id TEXT PRIMARY KEY NOT NULL, sha1 TEXT NOT NULL,
      label TEXT NOT NULL, source TEXT NOT NULL, locator TEXT NOT NULL,
      ext TEXT NOT NULL, mime TEXT NOT NULL, elo REAL DEFAULT 1000 NOT NULL,
      appearances INTEGER DEFAULT 0 NOT NULL, fools INTEGER DEFAULT 0 NOT NULL,
      retired INTEGER DEFAULT false NOT NULL, indexed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL)`,
    "CREATE UNIQUE INDEX images_sha1_unique ON images (sha1)",
    "DROP TABLE IF EXISTS rejected_images",
    `CREATE TABLE rejected_images (sha1 TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL, source_key TEXT, rejected_at INTEGER NOT NULL)`,
  ]);

  for (const k of Object.keys(s3Store)) delete s3Store[k];
  s3CopyLog.length = 0;
  s3DeleteLog.length = 0;
  s3ListCalls.length = 0;

  process.env.ROA_S3_BUCKET = "test-bucket";
  process.env.ROA_S3_PREFIX_AI = "ai/";
  process.env.ROA_S3_PREFIX_REAL = "real/";
  process.env.ROA_S3_PREFIX_PENDING = "pending-review/";

  const { __resetCatalogForTests } = await import("./catalog");
  __resetCatalogForTests();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aionot-pending-"));
  process.env.ROA_IMAGES_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.ROA_IMAGES_DIR;
  delete process.env.ROA_S3_BUCKET;
  delete process.env.ROA_S3_PREFIX_AI;
  delete process.env.ROA_S3_PREFIX_REAL;
  delete process.env.ROA_S3_PREFIX_PENDING;
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

const JPG = (s: string) => Buffer.from(`FAKEJPEG:${s}`);
const pendingKey = (label: "ai" | "real", name: string) =>
  `pending-review/${label}/${name}`;

// ---------------------------------------------------------------------------
// Registry: rejectSha1 / isSha1Rejected
// ---------------------------------------------------------------------------

describe("pendingKeyLabel (key-prefix security boundary)", () => {
  it("returns the label for a key under pending-review/ai/", async () => {
    const { pendingKeyLabel } = await import("./pending-review");
    expect(pendingKeyLabel("pending-review/ai/foo.jpg")).toBe("ai");
  });

  it("returns the label for a key under pending-review/real/", async () => {
    const { pendingKeyLabel } = await import("./pending-review");
    expect(pendingKeyLabel("pending-review/real/bar.png")).toBe("real");
  });

  it("rejects a key under the accepted ai/ prefix (no pending-review)", async () => {
    const { pendingKeyLabel } = await import("./pending-review");
    expect(pendingKeyLabel("ai/secret.jpg")).toBeNull();
  });

  it("rejects path-traversal attempts", async () => {
    const { pendingKeyLabel } = await import("./pending-review");
    expect(pendingKeyLabel("pending-review/../../etc/passwd")).toBeNull();
    expect(pendingKeyLabel("pending-review/ai/../../real/x.jpg")).toBe("ai");
  });

  it("rejects empty / garbage keys", async () => {
    const { pendingKeyLabel } = await import("./pending-review");
    expect(pendingKeyLabel("")).toBeNull();
    expect(pendingKeyLabel("pending-review/")).toBeNull();
    expect(pendingKeyLabel("pending-review/ai")).toBeNull();
  });
});

describe("rejected-image registry", () => {
  it("isSha1Rejected is false before any reject", async () => {
    const { isSha1Rejected } = await import("./pending-review");
    expect(await isSha1Rejected("0".repeat(40))).toBe(false);
  });

  it("rejectSha1 records the hash and isSha1Rejected becomes true", async () => {
    const { rejectSha1, isSha1Rejected } = await import("./pending-review");
    const sha = "a".repeat(40);
    await rejectSha1(sha, "ai", "pending-review/ai/bad.jpg");
    expect(await isSha1Rejected(sha)).toBe(true);
  });

  it("rejectSha1 is idempotent (re-rejecting the same hash is a no-op)", async () => {
    const { rejectSha1, isSha1Rejected } = await import("./pending-review");
    const sha = "b".repeat(40);
    await rejectSha1(sha, "real");
    await rejectSha1(sha, "real");
    expect(await isSha1Rejected(sha)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Global dedup: upload + reindex refuse banned hashes
// ---------------------------------------------------------------------------

describe("global dedup against rejected registry", () => {
  it("uploadImage refuses a banned hash (ok:false, reason rejected)", async () => {
    const { rejectSha1 } = await import("./pending-review");
    const { uploadImage, getCounts } = await import("./catalog");
    const bytes = JPG("banned-upload");
    const sha = (await import("./image-hash")).sha1Hex(bytes);
    await rejectSha1(sha, "ai");

    const res = await uploadImage("ai", "cat.jpg", bytes);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/reject/i);
    expect(await getCounts()).toEqual({ ai: 0, real: 0 });
  });

  it("reindexFromS3 skips a banned hash (counts as rejected, not added)", async () => {
    const { rejectSha1 } = await import("./pending-review");
    const { reindexFromS3, getCounts } = await import("./catalog");
    const bytes = JPG("banned-s3");
    const sha = (await import("./image-hash")).sha1Hex(bytes);
    await rejectSha1(sha, "ai");

    s3Store["ai/img-0.jpg"] = { bytes, etag: "etag-banned" };
    const res = await reindexFromS3();
    expect(res.added).toBe(0);
    expect(res.rejected).toBe(1);
    expect(await getCounts()).toEqual({ ai: 0, real: 0 });
  });

  it("reindexFromFs skips a banned hash on disk (counts as rejected)", async () => {
    const { rejectSha1 } = await import("./pending-review");
    const { reindexFromFs, getCounts } = await import("./catalog");
    const bytes = JPG("banned-fs");
    const sha = (await import("./image-hash")).sha1Hex(bytes);
    await rejectSha1(sha, "ai");

    await fs.mkdir(path.join(tmpDir!, "ai"), { recursive: true });
    await fs.writeFile(path.join(tmpDir!, "ai", "banned.jpg"), bytes);
    const res = await reindexFromFs();
    expect(res.added).toBe(0);
    expect(res.rejected).toBe(1);
    expect(await getCounts()).toEqual({ ai: 0, real: 0 });
  });
});

// ---------------------------------------------------------------------------
// Pending review: list / accept / reject
// ---------------------------------------------------------------------------

describe("pending-review: listPending", () => {
  it("lists pending items, optionally filtered by label", async () => {
    const { listPending } = await import("./pending-review");
    s3Store[pendingKey("ai", "a.jpg")] = { bytes: JPG("a"), etag: "e-a" };
    s3Store[pendingKey("ai", "b.jpg")] = { bytes: JPG("b"), etag: "e-b" };
    s3Store[pendingKey("real", "r.jpg")] = { bytes: JPG("r"), etag: "e-r" };

    const all = await listPending();
    expect(all).toHaveLength(3);
    const ai = await listPending("ai");
    expect(ai).toHaveLength(2);
    expect(ai.every((i: { label: string }) => i.label === "ai")).toBe(true);
    const real = await listPending("real");
    expect(real).toHaveLength(1);
    expect(real[0]!.label).toBe("real");
  });

  it("returns empty when no pending items", async () => {
    const { listPending } = await import("./pending-review");
    expect(await listPending()).toEqual([]);
  });

  it("limit caps the number of items returned and passes MaxKeys to S3", async () => {
    const { listPending } = await import("./pending-review");
    for (let i = 0; i < 10; i++) {
      s3Store[pendingKey("real", `img${i}.jpg`)] = {
        bytes: JPG(`real-${i}`),
        etag: `e-${i}`,
      };
    }
    const limited = await listPending("real", 3);
    expect(limited).toHaveLength(3);
    // The limit must reach listS3Images so S3 gets MaxKeys (not a full scan).
    const call = s3ListCalls.find((c) => c.prefix === "pending-review/real/");
    expect(call).toBeDefined();
    expect(call!.limit).toBe(3);
  });
});

describe("pending-review: reviewPending (accept)", () => {
  it("accept copies to the ai/ prefix, deletes from pending, indexes the row", async () => {
    const { reviewPending } = await import("./pending-review");
    const { getCounts, pickByLabel } = await import("./catalog");
    const bytes = JPG("accept-ai");
    const sha = (await import("./image-hash")).sha1Hex(bytes);
    const key = pendingKey("ai", "candidate.jpg");
    s3Store[key] = { bytes, etag: "e-cand" };

    const res = await reviewPending(key, "ai", "accept");
    expect(res.ok).toBe(true);
    expect(res.sha1).toBe(sha);
    expect(res.action).toBe("accept");
    expect(res.duplicate).toBe(false);
    expect(res.promotedTo).toMatch(/^ai\//);
    // Removed from pending.
    expect(s3Store[key]).toBeUndefined();
    // Exists at the destination (sha1-named).
    expect(s3Store[res.promotedTo!]).toBeDefined();
    // Entered rotation.
    expect(await getCounts()).toEqual({ ai: 1, real: 0 });
    const picked = await pickByLabel("ai");
    expect(picked).toBeDefined();
  });

  it("accept into real/ prefix for a real label", async () => {
    const { reviewPending } = await import("./pending-review");
    const { getCounts } = await import("./catalog");
    const bytes = JPG("accept-real");
    const key = pendingKey("real", "photo.jpg");
    s3Store[key] = { bytes, etag: "e-real" };

    const res = await reviewPending(key, "real", "accept");
    expect(res.ok).toBe(true);
    expect(res.promotedTo).toMatch(/^real\//);
    expect(await getCounts()).toEqual({ ai: 0, real: 1 });
  });

  it("accept records the locator pointing to the accepted key, not the deleted pending key", async () => {
    const { reviewPending } = await import("./pending-review");
    const { getEntry, readImageData } = await import("./catalog");
    const { sha1Hex, imageIdFromSha1 } = await import("./image-hash");
    const bytes = JPG("locator-check");
    const sha = sha1Hex(bytes);
    const id = imageIdFromSha1(sha);
    const key = pendingKey("ai", "loc.jpg");
    s3Store[key] = { bytes, etag: "e-loc" };

    const res = await reviewPending(key, "ai", "accept");
    expect(res.ok).toBe(true);
    // The DB row's locator must point at the LIVE accepted object…
    const entry = await getEntry(id);
    expect(entry).toBeDefined();
    expect(entry!.locator).toContain(`ai/${sha}`);
    expect(entry!.locator).not.toContain("pending-review");
    // …and reading the image bytes must succeed (not 404 on a deleted key).
    const data = await readImageData(entry!);
    expect(data.length).toBeGreaterThan(0);
  });

  it("accept reports duplicate when sha1 is already in rotation (still clears pending)", async () => {
    const { reviewPending } = await import("./pending-review");
    const { uploadImage } = await import("./catalog");
    const bytes = JPG("dup-accept");
    const sha = (await import("./image-hash")).sha1Hex(bytes);
    // First: land it in rotation via upload.
    const up = await uploadImage("ai", "orig.jpg", bytes);
    expect(up.ok).toBe(true);

    const key = pendingKey("ai", "again.jpg");
    s3Store[key] = { bytes, etag: "e-dup" };
    const res = await reviewPending(key, "ai", "accept");
    expect(res.ok).toBe(true);
    expect(res.duplicate).toBe(true);
    expect(res.sha1).toBe(sha);
    expect(s3Store[key]).toBeUndefined();
  });
});

describe("pending-review: reviewPending (reject)", () => {
  it("reject deletes the object and records the sha1 in the registry", async () => {
    const { reviewPending, isSha1Rejected } = await import("./pending-review");
    const { getCounts: catCounts } = await import("./catalog");
    const bytes = JPG("reject-this");
    const sha = (await import("./image-hash")).sha1Hex(bytes);
    const key = pendingKey("ai", "bad.jpg");
    s3Store[key] = { bytes, etag: "e-bad" };

    const res = await reviewPending(key, "ai", "reject");
    expect(res.ok).toBe(true);
    expect(res.sha1).toBe(sha);
    expect(res.action).toBe("reject");
    expect(s3Store[key]).toBeUndefined();
    expect(await isSha1Rejected(sha)).toBe(true);
    // Never entered rotation.
    expect(await catCounts()).toEqual({ ai: 0, real: 0 });
  });
});

describe("pending-review: cleanupRejectedPending (future-dedup)", () => {
  it("auto-deletes pending objects whose sha1 is already rejected", async () => {
    const { rejectSha1, cleanupRejectedPending, listPending } =
      await import("./pending-review");
    const bannedBytes = JPG("already-banned");
    const freshBytes = JPG("still-fresh");
    const bannedSha = (await import("./image-hash")).sha1Hex(bannedBytes);
    await rejectSha1(bannedSha, "ai");

    const bannedKey = pendingKey("ai", "banned.jpg");
    const freshKey = pendingKey("ai", "fresh.jpg");
    s3Store[bannedKey] = { bytes: bannedBytes, etag: "e1" };
    s3Store[freshKey] = { bytes: freshBytes, etag: "e2" };

    const res = await cleanupRejectedPending();
    expect(res.scanned).toBe(2);
    expect(res.deleted).toBe(1);
    // Banned is gone; fresh remains.
    expect(s3Store[bannedKey]).toBeUndefined();
    expect(s3Store[freshKey]).toBeDefined();
    const remaining = await listPending();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.key).toBe(freshKey);
  });

  it("scans zero when pending is empty", async () => {
    const { cleanupRejectedPending } = await import("./pending-review");
    const res = await cleanupRejectedPending();
    expect(res).toEqual({ scanned: 0, deleted: 0 });
  });
});
