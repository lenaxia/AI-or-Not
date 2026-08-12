import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
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
 * First-boot auto-migration: when we have not yet successfully completed a
 * FS scan, scan `images/{ai,real}/` exactly as the old catalog did, so
 * existing local deploys keep working with zero setup.
 *
 * Retry semantics: `bootFsScanDone` is only set on a *complete* scan. On
 * failure we (a) null `catalogPromise` so the next caller re-enters this
 * block (otherwise the resolved promise would short-circuit the outer
 * guard and the catalog would stay stale until restart) and (b) return the
 * already-loaded catalog to THIS caller so they get a valid (possibly
 * empty/partial) Catalog instead of null. The gate is `!bootFsScanDone`,
 * NOT `byId.size === 0` — that way a partial scan that inserted some rows
 * before throwing still retries (reindexFromFs is idempotent and skips
 * already-indexed files, so the retry picks up where it left off).
 *
 * Narrow race: a second request arriving while the first scan is mid-flight
 * awaits the pre-reload `catalogPromise` and may briefly see a stale
 * catalog. Self-heals on the next call.
 */
export async function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = loadFromDb();
    const cat = await catalogPromise;
    if (!bootFsScanDone) {
      try {
        await reindexFromFs();
        bootFsScanDone = true;
      } catch (err) {
        console.warn("[catalog] first-boot FS migration failed:", err);
        catalogPromise = null;
        return cat;
      }
    }
  }
  return catalogPromise!;
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

/**
 * Refresh a single entry in the in-memory cache after a write that touches
 * only one row (e.g. recordAppearance updating elo/appearances/fools).
 * Cheaper than reloadCache() — one SELECT, two map updates, kept in sync.
 *
 * If the row no longer exists, drops it from both maps. No-op if the cache
 * hasn't been populated yet (getCatalog() owns first-load).
 */
export async function refreshEntryInCache(id: string): Promise<void> {
  if (!catalogPromise) return;
  const cat = await catalogPromise;
  const rows = await db
    .select()
    .from(images)
    .where(eq(images.id, id))
    .limit(1);
  const old = cat.byId.get(id);
  if (old) {
    const arr = cat.byLabel[old.label];
    const i = arr.indexOf(old);
    if (i >= 0) arr.splice(i, 1);
  }
  if (rows.length > 0) {
    const e = toEntry(rows[0]!);
    cat.byId.set(id, e);
    cat.byLabel[e.label].push(e);
  } else {
    cat.byId.delete(id);
  }
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
  removed: number;
}> {
  const seenLocators = new Set<string>();

  // Pass 1: list files (no reading yet). Build the set of locators that
  // still exist on disk.
  const candidates: Array<{ label: Label; absPath: string; ext: string; mime: string }> = [];
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
      seenLocators.add(absPath);
      candidates.push({ label, absPath, ext, mime });
    }
  }

  // Cleanup: delete FS rows whose files are gone. Must happen BEFORE the
  // dedup check below — otherwise a moved file (same sha1, new path) gets
  // skipped as "already indexed" and then its old row gets cleaned up,
  // vanishing the image entirely.
  const fsRows = await db
    .select({ id: images.id, locator: images.locator })
    .from(images)
    .where(eq(images.source, "fs"));
  let removed = 0;
  for (const r of fsRows) {
    if (!seenLocators.has(r.locator)) {
      await db.delete(images).where(eq(images.id, r.id));
      removed++;
    }
  }

  // Pass 2: read + hash + insert. Rebuild the dedup set AFTER cleanup so
  // moved files (sha1 was in a now-deleted row) get re-added correctly.
  const surviving = await db.select({ sha1: images.sha1 }).from(images);
  const alreadyIndexed = new Set(surviving.map((r) => r.sha1));
  const seenThisRun = new Set<string>();

  let added = 0;
  let duplicates = 0;

  for (const c of candidates) {
    const bytes = await fs.readFile(c.absPath);
    const sha1 = sha1Hex(bytes);
    if (alreadyIndexed.has(sha1)) continue;
    if (seenThisRun.has(sha1)) {
      duplicates++;
      continue;
    }
    const now = Date.now();
    await db.insert(images).values({
      id: imageIdFromSha1(sha1),
      sha1,
      label: c.label,
      source: "fs",
      locator: c.absPath,
      ext: c.ext,
      mime: c.mime,
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

  await reloadCache();
  return { added, duplicates, removed };
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
  removed: number;
}> {
  if (!s3Enabled()) return { added: 0, duplicates: 0, skipped: 0, removed: 0 };

  const bucket = process.env.ROA_S3_BUCKET!.trim();
  const aiPrefix = process.env.ROA_S3_PREFIX_AI?.trim() || "ai/";
  const realPrefix = process.env.ROA_S3_PREFIX_REAL?.trim() || "real/";

  // Pass 1: list all objects, build seen-locator set. Same "cleanup before
  // dedup" structure as reindexFromFs — see comment there for rationale.
  const targets: Array<[Label, string]> = [
    ["ai", aiPrefix],
    ["real", realPrefix],
  ];
  const candidates: Array<{ label: Label; key: string; ext: string; mime: string }> = [];
  const seenLocators = new Set<string>();
  for (const [label, prefix] of targets) {
    const objects = await listS3Images(prefix);
    for (const obj of objects) {
      seenLocators.add(s3Locator(bucket, obj.key));
      candidates.push({ label, key: obj.key, ext: obj.ext, mime: obj.mime });
    }
  }

  // Cleanup: delete S3 rows whose objects are gone.
  const s3Rows = await db
    .select({ id: images.id, locator: images.locator })
    .from(images)
    .where(eq(images.source, "s3"));
  let removed = 0;
  for (const r of s3Rows) {
    if (!seenLocators.has(r.locator)) {
      await db.delete(images).where(eq(images.id, r.id));
      removed++;
    }
  }

  // Pass 2: fetch + hash + insert. Dedup against post-cleanup DB state.
  const surviving = await db.select({ sha1: images.sha1 }).from(images);
  const alreadyIndexed = new Set(surviving.map((r) => r.sha1));
  const seenThisRun = new Set<string>();

  let added = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const c of candidates) {
    let bytes: Buffer;
    try {
      bytes = await getS3Object(c.key);
    } catch (err) {
      skipped++;
      console.warn(`[catalog] s3 get failed for ${c.key}:`, err);
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
        label: c.label,
        source: "s3",
        locator: s3Locator(bucket, c.key),
        ext: c.ext,
        mime: c.mime,
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

  await reloadCache();
  return { added, duplicates, skipped, removed };
}

/** Combined reindex: FS then S3 (whichever sources are configured). */
export async function reindexAll(): Promise<{
  added: number;
  duplicates: number;
  skipped: number;
  removed: number;
}> {
  const fsRes = await reindexFromFs();
  const s3Res = await reindexFromS3();
  return {
    added: fsRes.added + s3Res.added,
    duplicates: fsRes.duplicates + s3Res.duplicates,
    skipped: s3Res.skipped,
    removed: fsRes.removed + s3Res.removed,
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

/** 25 MB per-file upload cap — protects the route from trivial OOM. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Persist a single uploaded file. Writes to the FS source (images/{label}/),
 * computes SHA1, dedupes against the table. Returns the outcome.
 *
 * Note: uploads always go to the FS source, even when S3 is configured —
 * keeps the operator workflow simple. Re-running reindex picks them up.
 */
export async function uploadImage(
  label: Label,
  filename: string,
  bytes: Buffer,
): Promise<
  { ok: true; id: string; sha1: string; duplicate: boolean } | { ok: false; error: string }
> {
  const ext = path.extname(filename).toLowerCase();
  const mime = IMAGE_EXT[ext];
  if (!mime) return { ok: false, error: `unsupported extension: ${ext}` };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `file exceeds ${MAX_UPLOAD_BYTES} byte cap` };
  }

  const sha1 = sha1Hex(bytes);
  const id = imageIdFromSha1(sha1);

  // Dedup against the table.
  const existing = await db
    .select({ id: images.id })
    .from(images)
    .where(eq(images.sha1, sha1));
  if (existing.length > 0) {
    return { ok: true, id: existing[0]!.id, sha1, duplicate: true };
  }

  // Write the file to images/{label}/<sha1><ext>. SHA1-based name keeps the
  // disk store content-addressed too (a reindex of the FS won't find dupes).
  const dir = path.join(imagesDir(), label);
  await fs.mkdir(dir, { recursive: true });
  const absPath = path.resolve(dir, `${sha1}${ext}`);
  await fs.writeFile(absPath, bytes);

  const now = Date.now();
  try {
    await db.insert(images).values({
      id,
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
  } catch (err) {
    // Race: a concurrent upload of identical content already inserted. Clean
    // up the file we just wrote (it's a duplicate) and report as a dup so
    // the operator sees consistent behavior. Only swallow UNIQUE-constraint
    // failures; rethrow real DB errors.
    const code = (err as { code?: string }).code;
    const msg = (err as { message?: string }).message ?? "";
    if (code === "SQLITE_CONSTRAINT" || /UNIQUE/i.test(msg)) {
      await fs.unlink(absPath).catch(() => {});
      return { ok: true, id, sha1, duplicate: true };
    }
    throw err;
  }
  await reloadCache();
  return { ok: true, id, sha1, duplicate: false };
}

/** Set the manual retired flag on an image. Returns true if it matched. */
export async function setImageRetired(
  imageId: string,
  retired: boolean,
): Promise<boolean> {
  const res = await db
    .update(images)
    .set({ retired, updatedAt: Date.now() })
    .where(eq(images.id, imageId));
  await reloadCache();
  return ((res as unknown as { rowsAffected?: number }).rowsAffected ?? 0) > 0;
}

/** Hard-delete a row. Does NOT touch the underlying file/object. */
export async function deleteImage(imageId: string): Promise<boolean> {
  const res = await db.delete(images).where(eq(images.id, imageId));
  await reloadCache();
  return ((res as unknown as { rowsAffected?: number }).rowsAffected ?? 0) > 0;
}

/** Paginated listing for the admin gallery. */
export async function listImages(opts: {
  label?: Label;
  retired?: boolean;
  page: number;
  pageSize: number;
}): Promise<{ rows: CatalogEntry[]; total: number }> {
  // Simple: pull all rows, filter + sort + slice in memory. Fine for a fun
  // project's image library sizes; revisit if it ever gets into the tens of
  // thousands. Avoids dynamic query building for two optional filters.
  const all = await db.select().from(images);
  const filtered = all
    .filter((r) => {
      if (opts.label && r.label !== opts.label) return false;
      if (opts.retired !== undefined && r.retired !== opts.retired) return false;
      return true;
    })
    .sort((a, b) => b.indexedAt - a.indexedAt);
  const total = filtered.length;
  const start = (opts.page - 1) * opts.pageSize;
  const rows = filtered.slice(start, start + opts.pageSize).map(toEntry);
  return { rows, total };
}

/** Two-column ELO listing, sorted desc within each label. */
export async function listByElo(): Promise<{
  ai: CatalogEntry[];
  real: CatalogEntry[];
}> {
  const all = await db.select().from(images);
  const sortDesc = (a: ImageRow, b: ImageRow) => b.elo - a.elo;
  return {
    ai: all.filter((r) => r.label === "ai").sort(sortDesc).map(toEntry),
    real: all.filter((r) => r.label === "real").sort(sortDesc).map(toEntry),
  };
}

/** Test-only: reset the in-memory cache + first-boot scan flag. */
export function __resetCatalogForTests(): void {
  catalogPromise = null;
  bootFsScanDone = false;
}
