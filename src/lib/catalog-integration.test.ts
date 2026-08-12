import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * Integration test for the PR-#15 schema-gate fix. Does NOT mock @/db, so
 * the real ensureSchema()/migrator runs against a fresh file DB. Verifies
 * getCatalog() resolves without hand-creating the images table — the exact
 * failure mode the review block called out.
 *
 * Each test gets a fresh module registry (vi.resetModules) so @/db picks up
 * the new ROA_DB_URL. Without that, the @/db client is cached across tests
 * and they'd all share one DB file.
 *
 * Note on the retry tests: they use fs.chmod(path, 0o000) to force a
 * readFile failure. Vitest's ESM module mocking cannot reliably intercept
 * `node:fs/promises` inside dynamically-imported modules (doMock is ignored
 * after resetModules; hoisted vi.mock closes over state by value), so the
 * chmod approach is the most reliable option. It is uid-sensitive: root
 * bypasses Unix perms, so these tests are SKIPPED when running as root.
 * The CI runner and the production Dockerfile both run as uid 1001, so
 * the tests run in every environment that actually matters.
 */

const isRoot = process.getuid?.() === 0;
const retryDescribe = isRoot ? describe.skip : describe;

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

retryDescribe("catalog integration: first-boot retry semantics", () => {
  // Regression for two review-round bugs:
  //  1. getCatalog() returned null on the failure path (the `!` hid it).
  //  2. Partial-scan failure orphaned rows because the retry gate was
  //     `byId.size === 0` — a partial scan left rows so retry never fired.
  // Both fixed: gate is now `!bootFsScanDone` (row-count independent), and
  // the catch returns the in-flight catalog to the failing caller.
  //
  // These tests use chmod 0o000 to force readFile failures, which root
  // bypasses — the describe.skip wrapper at the top guards that.

  it("returns a valid (empty) Catalog on first-call scan failure, then retries", async () => {
    const aiDir = path.join(tmpDir!, "images", "ai");
    await fs.mkdir(aiDir, { recursive: true });
    const file = path.join(aiDir, "a.jpg");
    await fs.writeFile(file, Buffer.from("FAKEJPEG:a"));

    const { getCatalog, __resetCatalogForTests } = await import("./catalog");
    __resetCatalogForTests();

    // Revoke read perm → first scan throws on readFile. Caller must get a
    // valid (empty) Catalog, not null.
    await fs.chmod(file, 0o000);
    const first = await getCatalog();
    expect(first).not.toBeNull();
    expect(first.byId.size).toBe(0);

    // Restore and retry — scan completes.
    await fs.chmod(file, 0o644);
    const second = await getCatalog();
    expect(second).not.toBeNull();
    expect(second.byId.size).toBe(1);
  });

  it("retries after a partial scan (already-inserted rows don't block the retry)", async () => {
    // Two files in ai/. First scan will insert one then throw on the other.
    // Retry must pick up the remainder — gate is !bootFsScanDone, not row
    // count, so partial rows don't block the retry.
    const aiDir = path.join(tmpDir!, "images", "ai");
    await fs.mkdir(aiDir, { recursive: true });
    const keep = path.join(aiDir, "keep.jpg");
    const locked = path.join(aiDir, "locked.jpg");
    await fs.writeFile(keep, Buffer.from("FAKEJPEG:keep"));
    await fs.writeFile(locked, Buffer.from("FAKEJPEG:locked"));

    const { getCatalog, __resetCatalogForTests } = await import("./catalog");
    __resetCatalogForTests();

    // Lock one file — readdir order is OS-dependent, so the scan throws on
    // whichever file hits the locked path first. Either way bootFsScanDone
    // stays false because the scan doesn't complete.
    await fs.chmod(locked, 0o000);
    const first = await getCatalog();
    // Returned catalog is the pre-scan snapshot (possibly empty, possibly
    // partial). What matters: non-null, graceful degradation.
    expect(first).not.toBeNull();

    // Unlock and retry. !bootFsScanDone is still true, so the retry fires
    // regardless of how many rows the partial scan left. reindexFromFs is
    // idempotent — skips already-indexed files, picks up the rest.
    await fs.chmod(locked, 0o644);
    const second = await getCatalog();
    expect(second.byId.size).toBe(2);
  });
});
