import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Integration test for the PR-#15 schema-gate fix. Does NOT mock @/db, so
 * the real ensureSchema()/migrator runs against a fresh file DB. Verifies
 * getCatalog() resolves without hand-creating the images table — the exact
 * failure mode the review block called out.
 *
 * Each test gets a fresh module registry (vi.resetModules) so @/db picks up
 * the new ROA_DB_URL. Without that, the @/db client is cached across tests
 * and they'd all share one DB file.
 */

let tmpDir: string;
let prevDbUrl: string | undefined;
let prevImagesDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aionot-int-"));
  prevDbUrl = process.env.ROA_DB_URL;
  prevImagesDir = process.env.ROA_IMAGES_DIR;
  process.env.ROA_DB_URL = `file:${path.join(tmpDir, "fresh.db")}`;
  process.env.ROA_IMAGES_DIR = path.join(tmpDir, "images");
  vi.resetModules();
});

afterEach(async () => {
  if (prevDbUrl === undefined) delete process.env.ROA_DB_URL;
  else process.env.ROA_DB_URL = prevDbUrl;
  if (prevImagesDir === undefined) delete process.env.ROA_IMAGES_DIR;
  else process.env.ROA_IMAGES_DIR = prevImagesDir;
  vi.resetModules();
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("catalog integration: schema gate", () => {
  it("getCatalog() resolves on a fresh DB by running migrations first", async () => {
    // No table hand-creation. The fresh DB file exists (libsql creates it)
    // but has no schema. getCatalog() must invoke ensureSchema() internally.
    const { getCatalog, __resetCatalogForTests } = await import("./catalog");
    __resetCatalogForTests();
    const cat = await getCatalog();
    expect(cat.byId.size).toBe(0);
    expect(cat.byLabel.ai).toEqual([]);
    expect(cat.byLabel.real).toEqual([]);
  });

  it("boot auto-migration populates from FS after schema gate runs", async () => {
    // Drop the FS dir + images dir, seed real files, then call getCatalog().
    // The chain is: ensureSchema → empty table → boot FS scan → reload cache.
    const aiDir = path.join(tmpDir!, "images", "ai");
    const realDir = path.join(tmpDir!, "images", "real");
    await fs.mkdir(aiDir, { recursive: true });
    await fs.mkdir(realDir, { recursive: true });
    await fs.writeFile(path.join(aiDir, "a.jpg"), Buffer.from("FAKEJPEG:a"));
    await fs.writeFile(path.join(realDir, "r.jpg"), Buffer.from("FAKEJPEG:r"));

    const { getCatalog, getCounts, __resetCatalogForTests } = await import("./catalog");
    __resetCatalogForTests();
    const cat = await getCatalog();
    expect(cat.byId.size).toBe(2);
    expect(await getCounts()).toEqual({ ai: 1, real: 1 });
  });
});

describe("catalog integration: first-boot retry semantics", () => {
  // Regression for two review-round bugs:
  //  1. getCatalog() returned null on the failure path (the `!` hid it).
  //  2. Partial-scan failure orphaned rows because the retry gate was
  //     `byId.size === 0` — a partial scan left rows so retry never fired.
  // Both fixed: gate is now `!bootFsScanDone` (row-count independent), and
  // the catch returns the in-flight catalog to the failing caller.

  it("returns a valid (empty) Catalog on first-call scan failure, then retries", async () => {
    const aiDir = path.join(tmpDir!, "images", "ai");
    await fs.mkdir(aiDir, { recursive: true });
    await fs.writeFile(path.join(aiDir, "a.jpg"), Buffer.from("FAKEJPEG:a"));

    const cat = await import("./catalog");
    const { getCatalog, __resetCatalogForTests } = cat;
    __resetCatalogForTests();

    // Force the FS scan to throw on the first call by revoking read perm on
    // the file. Restore before the retry so the second call succeeds.
    await fs.chmod(path.join(aiDir, "a.jpg"), 0o000);
    const first = await getCatalog();
    // Concern 1: first call must NOT be null — it returns the empty Catalog
    // so callers degrade gracefully (e.g. 503 not-enough-images, not 500).
    expect(first).not.toBeNull();
    expect(first.byId.size).toBe(0);

    // Restore and retry — the scan should now complete.
    await fs.chmod(path.join(aiDir, "a.jpg"), 0o644);
    const second = await getCatalog();
    expect(second).not.toBeNull();
    expect(second.byId.size).toBe(1);
  });

  it("retries after a partial scan (already-inserted rows don't block the retry)", async () => {
    // Two files in ai/. First scan will insert file 1 then throw on file 2.
    // Retry must pick up file 2 — the gate is !bootFsScanDone, not row count.
    const aiDir = path.join(tmpDir!, "images", "ai");
    await fs.mkdir(aiDir, { recursive: true });
    await fs.writeFile(path.join(aiDir, "keep.jpg"), Buffer.from("FAKEJPEG:keep"));
    await fs.writeFile(path.join(aiDir, "locked.jpg"), Buffer.from("FAKEJPEG:locked"));

    const cat = await import("./catalog");
    const { getCatalog, __resetCatalogForTests } = cat;
    __resetCatalogForTests();

    // Lock the second file → scan throws on it (whether before or after
    // keep.jpg is processed depends on readdir order). Either way the scan
    // doesn't complete, so bootFsScanDone stays false.
    await fs.chmod(path.join(aiDir, "locked.jpg"), 0o000);
    const first = await getCatalog();
    // The returned catalog is the pre-scan snapshot (possibly empty, possibly
    // partial). What matters: it's non-null and the caller degrades gracefully.
    expect(first).not.toBeNull();

    // Unlock and retry. !bootFsScanDone is still true (scan never completed),
    // so the retry fires regardless of how many rows the partial scan left.
    // reindexFromFs is idempotent — it skips already-indexed files and picks
    // up the rest.
    await fs.chmod(path.join(aiDir, "locked.jpg"), 0o644);
    const second = await getCatalog();
    expect(second.byId.size).toBe(2);
  });
});
