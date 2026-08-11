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
