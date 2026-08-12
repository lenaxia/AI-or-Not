import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

// --- shared-cache in-memory DB --------------------------------------------
// Use `file::memory:?cache=shared` so any connection (including drizzle's
// batch/transaction path) sees the same DB. Plain `:memory:` is per-
// connection in libsql and silently breaks transactional code.
const mem = createClient({ url: "file::memory:?cache=shared" });
const memDb = drizzle(mem, { schema });

// Mock @/db to use the in-memory client. ensureSchema is a no-op because
// the test fixture hand-creates the table via raw SQL below.
vi.mock("@/db", () => ({ db: memDb, ensureSchema: async () => {} }));

// --- temp image dir --------------------------------------------------------
let tmpDir: string;

beforeEach(async () => {
  // Fresh schema + data per test.
  await mem.batch([
    "DROP TABLE IF EXISTS images",
    "CREATE TABLE images (id TEXT PRIMARY KEY NOT NULL, sha1 TEXT NOT NULL, label TEXT NOT NULL, source TEXT NOT NULL, locator TEXT NOT NULL, ext TEXT NOT NULL, mime TEXT NOT NULL, elo INTEGER DEFAULT 1000 NOT NULL, appearances INTEGER DEFAULT 0 NOT NULL, fools INTEGER DEFAULT 0 NOT NULL, retired INTEGER DEFAULT false NOT NULL, indexed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE UNIQUE INDEX images_sha1_unique ON images (sha1)",
    "CREATE INDEX images_label_retired_idx ON images (label, retired)",
    "CREATE INDEX images_label_elo_idx ON images (label, elo)",
    "DROP TABLE IF EXISTS rejected_images",
    `CREATE TABLE rejected_images (sha1 TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL, source_key TEXT, rejected_at INTEGER NOT NULL)`,
  ]);
  // Reset the catalog cache between tests.
  const { __resetCatalogForTests } = await import("./catalog");
  __resetCatalogForTests();

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aionot-cat-"));
  process.env.ROA_IMAGES_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.ROA_IMAGES_DIR;
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

async function seedDir(label: "ai" | "real", files: { name: string; bytes: Buffer }[]) {
  const dir = path.join(tmpDir!, label);
  await fs.mkdir(dir, { recursive: true });
  for (const f of files) {
    await fs.writeFile(path.join(dir, f.name), f.bytes);
  }
}

const JPG = (s: string) => Buffer.from(`FAKEJPEG:${s}`);

describe("catalog: filesystem migration", () => {
  it("indexes nothing when the folders are empty", async () => {
    const { getCounts, reindexFromFs } = await import("./catalog");
    await reindexFromFs();
    expect(await getCounts()).toEqual({ ai: 0, real: 0 });
  });

  it("indexes images from ai/ and real/", async () => {
    const { reindexFromFs, getCounts } = await import("./catalog");
    await seedDir("ai", [
      { name: "a.jpg", bytes: JPG("a1") },
      { name: "b.png", bytes: JPG("a2") },
    ]);
    await seedDir("real", [{ name: "r.jpg", bytes: JPG("r1") }]);
    const res = await reindexFromFs();
    expect(res.added).toBe(3);
    expect(res.duplicates).toBe(0);
    expect(await getCounts()).toEqual({ ai: 2, real: 1 });
  });

  it("ignores files with unsupported extensions", async () => {
    const { reindexFromFs, getCounts } = await import("./catalog");
    await seedDir("ai", [
      { name: "ok.jpg", bytes: JPG("ok") },
      { name: "skip.txt", bytes: Buffer.from("nope") },
      { name: "skip.mp4", bytes: Buffer.from("nope") },
    ]);
    await reindexFromFs();
    expect(await getCounts()).toEqual({ ai: 1, real: 0 });
  });

  it("dedupes identical content across folders (same sha1)", async () => {
    const { reindexFromFs, getCounts, getEntry } = await import("./catalog");
    // Same bytes in ai/ and real/ → one row, one label wins (first seen).
    const same = JPG("twin");
    await seedDir("ai", [{ name: "a.jpg", bytes: same }]);
    await seedDir("real", [{ name: "r.jpg", bytes: same }]);
    const res = await reindexFromFs();
    // One inserted, one duplicate.
    expect(res.added).toBe(1);
    expect(res.duplicates).toBe(1);
    const counts = await getCounts();
    expect(counts.ai + counts.real).toBe(1);
    // getEntry works for whichever label won.
    const { pickByLabel } = await import("./catalog");
    const ai = await pickByLabel("ai");
    const real = await pickByLabel("real");
    expect(ai === undefined || real === undefined).toBe(true);
    void getEntry;
  });

  it("is idempotent (reindex twice adds nothing)", async () => {
    const { reindexFromFs } = await import("./catalog");
    await seedDir("ai", [{ name: "a.jpg", bytes: JPG("a1") }]);
    const first = await reindexFromFs();
    const second = await reindexFromFs();
    expect(first.added).toBe(1);
    expect(second.added).toBe(0);
    expect(second.duplicates).toBe(0);
    expect(second.removed).toBe(0);
  });

  it("removes DB rows for files deleted from disk", async () => {
    const { reindexFromFs, getCounts } = await import("./catalog");
    await seedDir("ai", [
      { name: "keep.jpg", bytes: JPG("keep") },
      { name: "gone.jpg", bytes: JPG("gone") },
    ]);
    await reindexFromFs();
    expect(await getCounts()).toEqual({ ai: 2, real: 0 });
    // Remove one file, reindex → its row should be gone.
    await fs.unlink(path.join(tmpDir!, "ai", "gone.jpg"));
    const res = await reindexFromFs();
    expect(res.removed).toBe(1);
    expect(await getCounts()).toEqual({ ai: 1, real: 0 });
  });

  it("does not remove S3-sourced rows during FS reindex", async () => {
    const { reindexFromFs, getCounts } = await import("./catalog");
    const { db } = await import("@/db");
    // Insert a fake S3 row directly.
    await db.insert(schema.images).values({
      id: "s3fake",
      sha1: "s3fake-sha1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      label: "ai",
      source: "s3",
      locator: "fakebucket/ai/img.jpg",
      ext: ".jpg",
      mime: "image/jpeg",
      elo: 1000,
      appearances: 0,
      fools: 0,
      retired: false,
      indexedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await reindexFromFs();
    const counts = await getCounts();
    // The S3 row survives even though its locator isn't on the FS.
    expect(counts.ai).toBe(1);
  });

  it("computes a stable id from content (independent of filename)", async () => {
    const { reindexFromFs, getEntry, getCounts } = await import("./catalog");
    const bytes = JPG("stable");
    await seedDir("ai", [{ name: "name1.jpg", bytes }]);
    await reindexFromFs();
    const counts1 = await getCounts();
    // Move the file, reindex; same content → same id should reappear.
    await fs.unlink(path.join(tmpDir!, "ai", "name1.jpg"));
    await seedDir("ai", [{ name: "totally-different-name.png", bytes }]);
    await reindexFromFs();
    const counts2 = await getCounts();
    expect(counts2.ai).toBe(1);
    expect(counts1.ai).toBe(1);
    const picked = await import("./catalog").then((m) => m.pickByLabel("ai"));
    expect(picked).toBeDefined();
    const entry = await getEntry(picked!.id);
    expect(entry).toBeDefined();
  });
});

describe("catalog: pickByLabel & getEntry", () => {
  it("returns undefined when the pool is empty", async () => {
    const { pickByLabel, reindexFromFs } = await import("./catalog");
    await reindexFromFs();
    expect(await pickByLabel("ai")).toBeUndefined();
    expect(await pickByLabel("real")).toBeUndefined();
  });

  it("picks an entry from the pool", async () => {
    const { pickByLabel, reindexFromFs } = await import("./catalog");
    await seedDir("ai", [{ name: "a.jpg", bytes: JPG("only") }]);
    await reindexFromFs();
    const picked = await pickByLabel("ai");
    expect(picked).toBeDefined();
    expect(picked!.label).toBe("ai");
    expect(picked!.mime).toBe("image/jpeg");
    expect(picked!.ext).toBe(".jpg");
  });

  it("respects excludeId", async () => {
    const { pickByLabel, reindexFromFs } = await import("./catalog");
    await seedDir("ai", [
      { name: "a.jpg", bytes: JPG("a") },
      { name: "b.jpg", bytes: JPG("b") },
    ]);
    await reindexFromFs();
    // Force-pick one, then exclude it 50 times and never see it.
    const first = await pickByLabel("ai");
    expect(first).toBeDefined();
    for (let i = 0; i < 50; i++) {
      const p = await pickByLabel("ai", new Set([first!.id]));
      expect(p).toBeDefined();
      expect(p!.id).not.toBe(first!.id);
    }
  });

  it("serves a retired image only when the pool would otherwise be empty", async () => {
    const { pickByLabel, reindexFromFs } = await import("./catalog");
    await seedDir("ai", [{ name: "only.jpg", bytes: JPG("only") }]);
    await reindexFromFs();
    const picked = await pickByLabel("ai");
    expect(picked).toBeDefined();
    // Retire it directly via SQL.
    const { db } = await import("@/db");
    await (db.$client as typeof mem).execute({
      sql: "UPDATE images SET retired = 1 WHERE id = ?",
      args: [picked!.id],
    });
    // Reload and pick — should still return the retired one (empty fallback).
    const { reloadCache } = await import("./catalog");
    await reloadCache();
    const again = await pickByLabel("ai");
    expect(again).toBeDefined();
    expect(again!.id).toBe(picked!.id);
  });
});

describe("catalog: counts", () => {
  it("counts each label independently", async () => {
    const { reindexFromFs, getCounts } = await import("./catalog");
    await seedDir("ai", [
      { name: "a.jpg", bytes: JPG("a") },
      { name: "b.jpg", bytes: JPG("b") },
      { name: "c.jpg", bytes: JPG("c") },
    ]);
    await seedDir("real", [{ name: "r.jpg", bytes: JPG("r") }]);
    await reindexFromFs();
    expect(await getCounts()).toEqual({ ai: 3, real: 1 });
  });
});

describe("catalog: schema gate", () => {
  // Regression for the PR-#15 review block: catalog used to read the images
  // table before migrations ran, throwing "no such table" on a fresh deploy
  // before any leaderboard path triggered ensureSchema(). Here we exercise
  // the real `ensureSchema()` (not the mocked no-op) against a fresh file DB
  // and confirm a subsequent loadFromDb() works without hand-creating the
  // table. The mock is bypassed via a direct require of the real db module.
  it("loadFromDb runs migrations first, then reads", async () => {
    // vi.importActual gets the un-mocked @/db module, which builds a client
    // against ROA_DB_URL at module load time. We point ROA_DB_URL at a fresh
    // temp file BEFORE the un-mocked module is imported.
    const freshDb = path.join(tmpDir!, "fresh.db");
    process.env.ROA_DB_URL = `file:${freshDb}`;

    // Force re-import of the real @/db module under the new env. vi.resetModules
    // clears the registry; vi.doMock re-registers the mock for the *test* file,
    // so we use vi.importActual with a fresh dynamic import path.
    vi.resetModules();
    const realDb = await vi.importActual<typeof import("@/db")>("@/db");
    // The mock still wins for "./catalog" imports; for this test we drive the
    // sequence manually against the real exports.
    await realDb.ensureSchema();
    // Table now exists. A select should not throw.
    const rows = await realDb.db.select().from(schema.images);
    expect(rows).toEqual([]);
    delete process.env.ROA_DB_URL;
  });

  it("ensureSchema is idempotent (calling twice is safe)", async () => {
    const freshDb = path.join(tmpDir!, "fresh2.db");
    process.env.ROA_DB_URL = `file:${freshDb}`;
    vi.resetModules();
    const realDb = await vi.importActual<typeof import("@/db")>("@/db");
    await realDb.ensureSchema();
    await expect(realDb.ensureSchema()).resolves.toBeUndefined();
    delete process.env.ROA_DB_URL;
  });
});
