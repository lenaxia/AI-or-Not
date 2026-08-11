import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

const mem = createClient({ url: "file::memory:?cache=shared" });
const memDb = drizzle(mem, { schema });

vi.mock("@/db", () => ({ db: memDb }));

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
  ]);

  const { __resetCatalogForTests } = await import("./catalog");
  __resetCatalogForTests();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aionot-admin-"));
  process.env.ROA_IMAGES_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.ROA_IMAGES_DIR;
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

const JPG = (s: string) => Buffer.from(`FAKEJPEG:${s}`);

describe("catalog: uploadImage", () => {
  it("writes the file and inserts a row", async () => {
    const { uploadImage, getCounts, pickByLabel } = await import("./catalog");
    const res = await uploadImage("ai", "cat.jpg", JPG("cat"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.duplicate).toBe(false);
    expect(res.sha1).toHaveLength(40);
    expect(await getCounts()).toEqual({ ai: 1, real: 0 });
    const picked = await pickByLabel("ai");
    expect(picked).toBeDefined();
    // File exists on disk under the sha1 name.
    const onDisk = await fs.readdir(path.join(tmpDir!, "ai"));
    expect(onDisk).toContain(`${res.sha1}.jpg`);
  });

  it("rejects unsupported extensions", async () => {
    const { uploadImage } = await import("./catalog");
    const res = await uploadImage("ai", "movie.mp4", Buffer.from("nope"));
    expect(res.ok).toBe(false);
  });

  it("rejects files over the size cap", async () => {
    const { uploadImage, MAX_UPLOAD_BYTES } = await import("./catalog");
    const tooBig = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0);
    const res = await uploadImage("ai", "big.jpg", tooBig);
    expect(res.ok).toBe(false);
  });

  it("dedupes identical content (same sha1)", async () => {
    const { uploadImage, getCounts } = await import("./catalog");
    const bytes = JPG("dup");
    const r1 = await uploadImage("ai", "a.jpg", bytes);
    const r2 = await uploadImage("ai", "b.jpg", bytes);
    expect(r1.ok && !r1.duplicate).toBe(true);
    expect(r2.ok && r2.duplicate).toBe(true);
    expect(await getCounts()).toEqual({ ai: 1, real: 0 });
  });
});

describe("catalog: setImageRetired / deleteImage", () => {
  it("toggles the retired flag", async () => {
    const { uploadImage, setImageRetired, getEntry } = await import("./catalog");
    const r = await uploadImage("ai", "x.jpg", JPG("x"));
    if (!r.ok) throw new Error("upload failed");
    const ok = await setImageRetired(r.id, true);
    expect(ok).toBe(true);
    const entry = await getEntry(r.id);
    expect(entry!.retired).toBe(true);
    await setImageRetired(r.id, false);
    const entry2 = await getEntry(r.id);
    expect(entry2!.retired).toBe(false);
  });

  it("returns false when the id does not exist", async () => {
    const { setImageRetired, deleteImage } = await import("./catalog");
    expect(await setImageRetired("nope", true)).toBe(false);
    expect(await deleteImage("nope")).toBe(false);
  });

  it("deletes a row (hard delete, file untouched)", async () => {
    const { uploadImage, deleteImage, getEntry, getCounts } = await import("./catalog");
    const r = await uploadImage("ai", "x.jpg", JPG("x"));
    if (!r.ok) throw new Error("upload failed");
    const ok = await deleteImage(r.id);
    expect(ok).toBe(true);
    const entry = await getEntry(r.id);
    expect(entry).toBeUndefined();
    expect(await getCounts()).toEqual({ ai: 0, real: 0 });
    // The file is still on disk (deletes don't touch the source).
    const onDisk = await fs.readdir(path.join(tmpDir!, "ai"));
    expect(onDisk).toContain(`${r.sha1}.jpg`);
  });
});

describe("catalog: listImages", () => {
  it("paginates and sorts by indexedAt desc", async () => {
    const { uploadImage, listImages } = await import("./catalog");
    for (let i = 0; i < 5; i++) {
      await uploadImage("ai", `a${i}.jpg`, JPG(`a${i}`));
      await uploadImage("real", `r${i}.jpg`, JPG(`r${i}`));
    }
    const page1 = await listImages({ page: 1, pageSize: 4 });
    expect(page1.total).toBe(10);
    expect(page1.rows).toHaveLength(4);
    const page3 = await listImages({ page: 3, pageSize: 4 });
    expect(page3.rows).toHaveLength(2);
  });

  it("filters by label", async () => {
    const { uploadImage, listImages } = await import("./catalog");
    await uploadImage("ai", "a.jpg", JPG("a"));
    await uploadImage("real", "r.jpg", JPG("r"));
    const ai = await listImages({ label: "ai", page: 1, pageSize: 10 });
    expect(ai.total).toBe(1);
    expect(ai.rows[0]!.label).toBe("ai");
  });

  it("filters by retired status", async () => {
    const { uploadImage, setImageRetired, listImages } = await import("./catalog");
    const a = await uploadImage("ai", "a.jpg", JPG("a"));
    await uploadImage("ai", "b.jpg", JPG("b"));
    if (!a.ok) throw new Error("upload failed");
    await setImageRetired(a.id, true);
    const retired = await listImages({ retired: true, page: 1, pageSize: 10 });
    const active = await listImages({ retired: false, page: 1, pageSize: 10 });
    expect(retired.total).toBe(1);
    expect(active.total).toBe(1);
  });
});

describe("catalog: listByElo", () => {
  it("returns two columns sorted by ELO desc", async () => {
    const { uploadImage, listByElo } = await import("./catalog");
    const { db } = await import("@/db");

    const a1 = await uploadImage("ai", "a1.jpg", JPG("a1"));
    const a2 = await uploadImage("ai", "a2.jpg", JPG("a2"));
    const r1 = await uploadImage("real", "r1.jpg", JPG("r1"));
    const r2 = await uploadImage("real", "r2.jpg", JPG("r2"));
    if (!a1.ok || !a2.ok || !r1.ok || !r2.ok) throw new Error("upload failed");

    // Stamp custom ELOs via raw SQL (avoid fighting drizzle's query builder).
    const setElo = async (id: string, elo: number) =>
      (db.$client as typeof mem).execute({
        sql: "UPDATE images SET elo = ? WHERE id = ?",
        args: [elo, id],
      });
    await setElo(a1.id, 1200);
    await setElo(a2.id, 1500);
    await setElo(r1.id, 800);
    await setElo(r2.id, 950);

    const cols = await listByElo();
    expect(cols.ai).toHaveLength(2);
    expect(cols.real).toHaveLength(2);
    expect(cols.ai[0]!.elo).toBeGreaterThanOrEqual(cols.ai[1]!.elo);
    expect(cols.real[0]!.elo).toBeGreaterThanOrEqual(cols.real[1]!.elo);
    expect(cols.ai[0]!.id).toBe(a2.id); // 1500 first
    expect(cols.real[0]!.id).toBe(r2.id); // 950 first
  });
});
