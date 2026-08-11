import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { images, type ImageRow } from "@/db/schema";
import type { CatalogEntry, Label } from "./types";
import { sha1Hex, imageIdFromSha1 } from "./image-hash";

function imagesDir(): string {
  return process.env.ROA_IMAGES_DIR?.trim() || path.join(process.cwd(), "images");
}

/**
 * Images below this ELO are excluded from rotation (runtime check, never
 * persisted). Tune via ROA_ELO_RETIRE_BELOW. Default 600.
 */
const ELO_RETIRE_BELOW = Number(process.env.ROA_ELO_RETIRE_BELOW) || 600;

const IMAGE_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const LABELS: Label[] = ["ai", "real"];

interface Catalog {
  byId: Map<string, CatalogEntry>;
  byLabel: Record<Label, CatalogEntry[]>;
}

let catalogPromise: Promise<Catalog> | null = null;
let fsIndexAttempted = false;

function toEntry(row: ImageRow): CatalogEntry {
  return {
    id: row.id,
    sha1: row.sha1,
    absPath: row.source === "fs" ? row.locator : "",
    locator: row.locator,
    source: row.source,
    ext: row.ext,
    mime: row.mime,
    label: row.label,
    elo: row.elo,
    appearances: row.appearances,
    fools: row.fools,
    retired: row.retired,
  };
}

async function loadFromDb(): Promise<Catalog> {
  const rows = await db.select().from(images);
  const byId = new Map<string, CatalogEntry>();
  const byLabel: Record<Label, CatalogEntry[]> = { ai: [], real: [] };
  for (const r of rows) {
    const e = toEntry(r);
    byId.set(e.id, e);
    byLabel[e.label].push(e);
  }
  return { byId, byLabel };
}

/**
 * Drop the in-memory cache and re-read everything from the `images` table.
 * Call after any write (reindex, upload, retire, delete) so the hot path
 * (pickByLabel / getEntry) stays a pure memory read.
 */
export async function reloadCache(): Promise<void> {
  catalogPromise = loadFromDb();
  await catalogPromise;
}

export async function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = loadFromDb();
    // First-load one-time filesystem migration: if the table is empty and
    // we've never tried indexing, scan images/{ai,real}/ exactly as the old
    // catalog did, so existing local deploys keep working with zero setup.
    const cat = await catalogPromise;
    if (cat.byId.size === 0 && !fsIndexAttempted) {
      fsIndexAttempted = true;
      try {
        await reindexFromFs();
      } catch (err) {
        console.warn("[catalog] first-boot FS migration failed:", err);
      }
    }
  }
  return catalogPromise;
}

export async function getEntry(
  id: string,
): Promise<CatalogEntry | undefined> {
  const cat = await getCatalog();
  const cached = cat.byId.get(id);
  if (cached) return cached;
  // Cache miss after a write: query the DB and stash it.
  const rows = await db.select().from(images).where(eq(images.id, id));
  if (rows.length === 0) return undefined;
  const e = toEntry(rows[0]!);
  cat.byId.set(id, e);
  return e;
}

export async function getCounts(): Promise<{ ai: number; real: number }> {
  const cat = await getCatalog();
  return { ai: cat.byLabel.ai.length, real: cat.byLabel.real.length };
}

function pick<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function eligible(pool: CatalogEntry[]): CatalogEntry[] {
  return pool.filter((e) => !e.retired && e.elo >= ELO_RETIRE_BELOW);
}

export async function pickByLabel(
  label: Label,
  excludeId?: string,
): Promise<CatalogEntry | undefined> {
  const cat = await getCatalog();
  const all = cat.byLabel[label];

  // 1. Rotation-eligible pool (active + above ELO floor).
  let pool = eligible(all);
  if (excludeId) pool = pool.filter((e) => e.id !== excludeId);

  // 2. Empty-pool fallback: relax the ELO floor (still skip manually retired).
  //    Keeps the game from 503'ing when every image of a label dips below
  //    the floor. Note: we deliberately don't relax to <2 here — a single
  //    eligible image is fine for "left"/"right" rounds; only "both"/"none"
  //    (which pass excludeId) would fail, and that's handled by step 3.
  if (pool.length === 0) {
    pool = all.filter((e) => !e.retired && e.id !== excludeId);
  }

  // 3. Last-resort: include manually retired ones too. Better a retired
  //    image than a broken game.
  if (pool.length === 0) {
    pool = all.filter((e) => e.id !== excludeId);
  }

  return pick(pool);
}

/**
 * Scan images/{ai,real}/ on disk and upsert into the `images` table keyed by
 * content SHA1. Idempotent: a second run adds nothing new (dedup by sha1).
 * Existing rows are never touched (ELO/retired preserved). Returns counts.
 */
export async function reindexFromFs(): Promise<{
  added: number;
  duplicates: number;
}> {
  const existing = await db.select({ sha1: images.sha1 }).from(images);
  const alreadyIndexed = new Set(existing.map((r) => r.sha1));
  const seenThisRun = new Set<string>();

  let added = 0;
  let duplicates = 0;

  for (const label of LABELS) {
    const dir = path.join(imagesDir(), label);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      const mime = IMAGE_EXT[ext];
      if (!mime) continue;
      const absPath = path.resolve(dir, name);
      const bytes = await fs.readFile(absPath);
      const sha1 = sha1Hex(bytes);

      // Already in the DB from a prior run → no-op (not a "duplicate").
      if (alreadyIndexed.has(sha1)) continue;
      // Seen earlier in THIS run at a different path → real duplicate.
      if (seenThisRun.has(sha1)) {
        duplicates++;
        continue;
      }
      const now = Date.now();
      await db.insert(images).values({
        id: imageIdFromSha1(sha1),
        sha1,
        label,
        source: "fs",
        locator: absPath,
        ext,
        mime,
        elo: 1000,
        appearances: 0,
        fools: 0,
        retired: false,
        indexedAt: now,
        updatedAt: now,
      });
      seenThisRun.add(sha1);
      added++;
    }
  }

  await reloadCache();
  return { added, duplicates };
}

/** Test-only: reset the in-memory cache + FS-attempt flag. */
export function __resetCatalogForTests(): void {
  catalogPromise = null;
  fsIndexAttempted = false;
}
