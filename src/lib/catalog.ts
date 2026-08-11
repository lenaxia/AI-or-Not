import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { db, ensureSchema } from "@/db";
import { images, type ImageRow } from "@/db/schema";
import type { CatalogEntry, Label } from "./types";
import { sha1Hex, imageIdFromSha1 } from "./image-hash";
import { listS3Images, getS3Object, s3Locator, s3Enabled } from "./s3";

function imagesDir(): string {
  return process.env.ROA_IMAGES_DIR?.trim() || path.join(process.cwd(), "images");
}

/**
 * Images below this ELO are excluded from rotation (runtime check, never
 * persisted). Tune via ROA_ELO_RETIRE_BELOW. Default 600. Set to 0 to
 * disable the floor entirely.
 */
const ELO_RETIRE_BELOWRaw = process.env.ROA_ELO_RETIRE_BELOW;
const ELO_RETIRE_BELOW =
  ELO_RETIRE_BELOWRaw === undefined || ELO_RETIRE_BELOWRaw.trim() === ""
    ? 600
    : Number(ELO_RETIRE_BELOWRaw);

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
let bootFsScanDone = false;

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
  // Migrations MUST have run before we read the `images` table — otherwise
  // a fresh deploy throws "no such table" on the very first /api/game/round
  // request, before any leaderboard path has triggered ensureSchema().
  await ensureSchema();
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

/**
 * First-boot auto-migration: when the table is empty AND we have not yet
 * successfully completed a FS scan, scan `images/{ai,real}/` exactly as the
 * old catalog did, so existing local deploys keep working with zero setup.
 *
 * `bootFsScanDone` is only set on success — a transient FS failure
 * (permissions, mis-mounted volume) leaves it false so the next call retries.
 * Narrow race: a second request arriving while the first scan is mid-flight
 * awaits the pre-reload `catalogPromise` and may briefly see an empty
 * catalog. Self-heals on the next call (which hits the populated cache).
 */
export async function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = loadFromDb();
    const cat = await catalogPromise;
    if (cat.byId.size === 0 && !bootFsScanDone) {
      try {
        await reindexFromFs();
        bootFsScanDone = true;
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
  // Lookups go through the cache only. Writers (reindex/upload/retire/delete)
  // all end with reloadCache(), so the cache is always authoritative. We
  // deliberately do NOT do an incremental stash here — earlier code added
  // missed rows to byId but not byLabel, leaving the two maps inconsistent.
  return cat.byId.get(id);
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

/**
 * Scan the configured S3 bucket (ROA_S3_BUCKET) under ROA_S3_PREFIX_AI and
 * ROA_S3_PREFIX_REAL and upsert into the `images` table. Same dedup rules as
 * reindexFromFs: a sha1 already in the DB (from any source) is a no-op; a
 * sha1 seen twice within this run counts as a duplicate. Idempotent.
 *
 * Cost is dominated by GetObject (to hash). For large buckets this is slow;
 * run it from a script, not the admin button — see design doc stress note #4.
 */
export async function reindexFromS3(): Promise<{
  added: number;
  duplicates: number;
  skipped: number;
}> {
  if (!s3Enabled()) return { added: 0, duplicates: 0, skipped: 0 };

  const bucket = process.env.ROA_S3_BUCKET!.trim();
  const aiPrefix = process.env.ROA_S3_PREFIX_AI?.trim() || "ai/";
  const realPrefix = process.env.ROA_S3_PREFIX_REAL?.trim() || "real/";

  const existing = await db.select({ sha1: images.sha1 }).from(images);
  const alreadyIndexed = new Set(existing.map((r) => r.sha1));
  const seenThisRun = new Set<string>();

  let added = 0;
  let duplicates = 0;
  let skipped = 0;

  const targets: Array<[Label, string]> = [
    ["ai", aiPrefix],
    ["real", realPrefix],
  ];

  for (const [label, prefix] of targets) {
    const objects = await listS3Images(prefix);
    for (const obj of objects) {
      // ETag fast-path: for single-part uploads, ETag = MD5 of content. We
      // still SHA1 the bytes (cheap, dedup key is SHA1 by contract), but we
      // could use ETag as a prefilter. We hash all objects here for
      // correctness — reindex isn't hot.
      let bytes: Buffer;
      try {
        bytes = await getS3Object(obj.key);
      } catch (err) {
        skipped++;
        console.warn(`[catalog] s3 get failed for ${obj.key}:`, err);
        continue;
      }
      const sha1 = sha1Hex(bytes);
      if (alreadyIndexed.has(sha1)) continue;
      if (seenThisRun.has(sha1)) {
        duplicates++;
        continue;
      }
      const now = Date.now();
      try {
        await db.insert(images).values({
          id: imageIdFromSha1(sha1),
          sha1,
          label,
          source: "s3",
          locator: s3Locator(bucket, obj.key),
          ext: obj.ext,
          mime: obj.mime,
          elo: 1000,
          appearances: 0,
          fools: 0,
          retired: false,
          indexedAt: now,
          updatedAt: now,
        });
      } catch (err) {
        // Only swallow the UNIQUE-constraint race; rethrow real DB failures
        // (connection lost, disk full, schema drift) so they don't get
        // silently counted as "skipped" alongside transient GET failures.
        const code = (err as { code?: string }).code;
        const msg = (err as { message?: string }).message ?? "";
        if (code === "SQLITE_CONSTRAINT" || /UNIQUE/i.test(msg)) {
          skipped++;
          continue;
        }
        throw err;
      }
      seenThisRun.add(sha1);
      added++;
    }
  }

  await reloadCache();
  return { added, duplicates, skipped };
}

/** Combined reindex: FS then S3 (whichever sources are configured). */
export async function reindexAll(): Promise<{
  added: number;
  duplicates: number;
  skipped: number;
}> {
  const fsRes = await reindexFromFs();
  const s3Res = await reindexFromS3();
  return {
    added: fsRes.added + s3Res.added,
    duplicates: fsRes.duplicates + s3Res.duplicates,
    skipped: s3Res.skipped,
  };
}

/**
 * Fetch the raw bytes for a catalog entry, transparently handling fs vs s3.
 * Used by the image-proxy route handler.
 */
export async function readImageData(entry: CatalogEntry): Promise<Buffer> {
  if (entry.source === "fs") {
    return fs.readFile(entry.locator);
  }
  const { parseLocator } = await import("./s3");
  const { bucket, key } = parseLocator(entry.locator);
  // Reuse the configured client; bucket in locator is informational.
  void bucket;
  return getS3Object(key);
}

/** Test-only: reset the in-memory cache + FS-attempt flag. */
/** Test-only: reset the in-memory cache + first-boot scan flag. */
export function __resetCatalogForTests(): void {
  catalogPromise = null;
  bootFsScanDone = false;
}
