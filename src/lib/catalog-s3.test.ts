import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

// --- in-memory DB shared by all tests in this file ------------------------
const mem = createClient({ url: ":memory:" });
const memDb = drizzle(mem, { schema });

vi.mock("@/db", () => ({ db: memDb }));

// Mock the S3 module: we control list + get entirely from the test.
const s3State: Record<string, { bytes: Buffer; etag: string }[]> = {};
vi.mock("./s3", () => ({
  s3Enabled: () => !!process.env.ROA_S3_BUCKET,
  listS3Images: async (prefix: string) => {
    const items = s3State[prefix] ?? [];
    return items.map((it, i) => ({
      key: `${prefix}img-${i}.jpg`,
      ext: ".jpg",
      mime: "image/jpeg",
      etag: it.etag,
    }));
  },
  getS3Object: async (key: string) => {
    // key = prefix + filename; find the matching bytes.
    for (const [prefix, items] of Object.entries(s3State)) {
      const i = items.findIndex((_, idx) => `${prefix}img-${idx}.jpg` === key);
      if (i >= 0) return items[i]!.bytes;
    }
    throw new Error(`mock: no object for ${key}`);
  },
  s3Locator: (bucket: string, key: string) => `${bucket}/${key}`,
}));

let tmpDir: string;

beforeEach(async () => {
  await mem.batch([
    "DROP TABLE IF EXISTS images",
    `CREATE TABLE images (id TEXT PRIMARY KEY NOT NULL, sha1 TEXT NOT NULL,
      label TEXT NOT NULL, source TEXT NOT NULL, locator TEXT NOT NULL,
      ext TEXT NOT NULL, mime TEXT NOT NULL, elo INTEGER DEFAULT 1000 NOT NULL,
      appearances INTEGER DEFAULT 0 NOT NULL, fools INTEGER DEFAULT 0 NOT NULL,
      retired INTEGER DEFAULT false NOT NULL, indexed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL)`,
    "CREATE UNIQUE INDEX images_sha1_unique ON images (sha1)",
  ]);
  for (const k of Object.keys(s3State)) delete s3State[k];
  delete process.env.ROA_S3_BUCKET;
  delete process.env.ROA_S3_PREFIX_AI;
  delete process.env.ROA_S3_PREFIX_REAL;

  const { __resetCatalogForTests } = await import("./catalog");
  __resetCatalogForTests();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aionot-s3-"));
  process.env.ROA_IMAGES_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.ROA_IMAGES_DIR;
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

const JPG = (s: string) => Buffer.from(`FAKEJPEG:${s}`);

describe("catalog: reindexFromS3", () => {
  it("is a no-op when S3 is not configured", async () => {
    const { reindexFromS3 } = await import("./catalog");
    const res = await reindexFromS3();
    expect(res).toEqual({ added: 0, duplicates: 0, skipped: 0 });
  });

  it("indexes images from the configured S3 prefixes", async () => {
    process.env.ROA_S3_BUCKET = "test-bucket";
    process.env.ROA_S3_PREFIX_AI = "ai/";
    process.env.ROA_S3_PREFIX_REAL = "real/";
    s3State["ai/"] = [
      { bytes: JPG("ai-1"), etag: "etag-ai-1" },
      { bytes: JPG("ai-2"), etag: "etag-ai-2" },
    ];
    s3State["real/"] = [{ bytes: JPG("real-1"), etag: "etag-real-1" }];

    const { reindexFromS3, getCounts } = await import("./catalog");
    const res = await reindexFromS3();
    expect(res.added).toBe(3);
    expect(res.duplicates).toBe(0);
    expect(res.skipped).toBe(0);
    expect(await getCounts()).toEqual({ ai: 2, real: 1 });
  });

  it("marks s3 rows with source=s3 and a bucket/key locator", async () => {
    process.env.ROA_S3_BUCKET = "test-bucket";
    process.env.ROA_S3_PREFIX_AI = "ai/";
    s3State["ai/"] = [{ bytes: JPG("only"), etag: "etag-only" }];

    const { reindexFromS3, pickByLabel } = await import("./catalog");
    await reindexFromS3();
    const picked = await pickByLabel("ai");
    expect(picked).toBeDefined();
    expect(picked!.source).toBe("s3");
    expect(picked!.locator).toBe("test-bucket/ai/img-0.jpg");
  });

  it("dedupes identical content within one run (same sha1 across prefixes)", async () => {
    process.env.ROA_S3_BUCKET = "test-bucket";
    process.env.ROA_S3_PREFIX_AI = "ai/";
    process.env.ROA_S3_PREFIX_REAL = "real/";
    const same = JPG("twin");
    s3State["ai/"] = [{ bytes: same, etag: "etag-same" }];
    s3State["real/"] = [{ bytes: same, etag: "etag-same" }];

    const { reindexFromS3, getCounts } = await import("./catalog");
    const res = await reindexFromS3();
    expect(res.added).toBe(1);
    expect(res.duplicates).toBe(1);
    const counts = await getCounts();
    expect(counts.ai + counts.real).toBe(1);
  });

  it("is idempotent (second run adds nothing)", async () => {
    process.env.ROA_S3_BUCKET = "test-bucket";
    process.env.ROA_S3_PREFIX_AI = "ai/";
    s3State["ai/"] = [{ bytes: JPG("once"), etag: "etag-once" }];

    const { reindexFromS3 } = await import("./catalog");
    const first = await reindexFromS3();
    const second = await reindexFromS3();
    expect(first.added).toBe(1);
    expect(second.added).toBe(0);
    expect(second.duplicates).toBe(0);
  });

  it("skips objects whose GET fails (counts as skipped, not added)", async () => {
    process.env.ROA_S3_BUCKET = "test-bucket";
    process.env.ROA_S3_PREFIX_AI = "ai/";
    s3State["ai/"] = [{ bytes: JPG("ok"), etag: "etag-ok" }];

    // Override getS3Object to throw on the first call.
    const s3Mod = await import("./s3");
    const original = s3Mod.getS3Object;
    let calls = 0;
    (s3Mod as { getS3Object: typeof original }).getS3Object = async () => {
      calls++;
      if (calls === 1) throw new Error("simulated transient");
      return JPG("ok");
    };

    const { reindexFromS3, getCounts } = await import("./catalog");
    const res = await reindexFromS3();
    expect(res.skipped).toBe(1);
    expect(res.added).toBe(0);
    expect(await getCounts()).toEqual({ ai: 0, real: 0 });
    // Restore.
    (s3Mod as { getS3Object: typeof original }).getS3Object = original;
  });
});

describe("catalog: reindexAll (FS + S3 combined)", () => {
  it("indexes both sources and dedupes across them by sha1", async () => {
    process.env.ROA_S3_BUCKET = "test-bucket";
    process.env.ROA_S3_PREFIX_AI = "ai/";
    process.env.ROA_S3_PREFIX_REAL = "real/";

    // FS has ai-1 + ai-2; S3 has ai-2 (dup of FS) + ai-3 + real-1.
    await fs.mkdir(path.join(tmpDir!, "ai"), { recursive: true });
    await fs.writeFile(path.join(tmpDir!, "ai", "a1.jpg"), JPG("ai-1"));
    await fs.writeFile(path.join(tmpDir!, "ai", "a2.jpg"), JPG("ai-2"));
    s3State["ai/"] = [
      { bytes: JPG("ai-2"), etag: "etag-ai-2" }, // dup with FS
      { bytes: JPG("ai-3"), etag: "etag-ai-3" },
    ];
    s3State["real/"] = [{ bytes: JPG("real-1"), etag: "etag-real-1" }];

    const { reindexAll, getCounts } = await import("./catalog");
    const res = await reindexAll();
    // FS adds 2; S3 sees ai-2 as alreadyIndexed (no-op, not duplicate),
    // then adds ai-3 and real-1.
    expect(res.added).toBe(4);
    expect(res.duplicates).toBe(0);
    expect(await getCounts()).toEqual({ ai: 3, real: 1 });
  });
});
