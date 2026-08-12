import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rejectedImages } from "@/db/schema";
import type { Label } from "./types";
import { sha1Hex, imageIdFromSha1 } from "./image-hash";
import { reloadCache } from "./catalog";
import {
  listS3Images,
  getS3Object,
  copyS3Object,
  deleteS3Object,
  s3Locator,
} from "./s3";

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

function pendingPrefixRoot(): string {
  return process.env.ROA_S3_PREFIX_PENDING?.trim() || "pending-review/";
}

function acceptedPrefix(label: Label): string {
  return label === "ai"
    ? process.env.ROA_S3_PREFIX_AI?.trim() || "ai/"
    : process.env.ROA_S3_PREFIX_REAL?.trim() || "real/";
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Record a SHA1 as rejected. Idempotent (INSERT OR IGNORE). */
export async function rejectSha1(
  sha1: string,
  label: Label,
  sourceKey?: string,
): Promise<void> {
  await db
    .insert(rejectedImages)
    .values({ sha1, label, sourceKey, rejectedAt: Date.now() })
    .onConflictDoNothing();
}

/** True if this content hash has been rejected by an admin. */
export async function isSha1Rejected(sha1: string): Promise<boolean> {
  const rows = await db
    .select({ sha1: rejectedImages.sha1 })
    .from(rejectedImages)
    .where(sql`${rejectedImages.sha1} = ${sha1}`)
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Pending listing
// ---------------------------------------------------------------------------

export interface PendingItem {
  key: string;
  label: Label;
  size: number;
  ext: string;
  mime: string;
  etag: string;
}

/** List candidate images under pending-review/{ai,real}/. */
export async function listPending(label?: Label): Promise<PendingItem[]> {
  if (!process.env.ROA_S3_BUCKET?.trim()) return [];
  const root = pendingPrefixRoot();
  const labels: Label[] = label ? [label] : ["ai", "real"];
  const out: PendingItem[] = [];
  for (const l of labels) {
    const prefix = `${root}${l}/`;
    const objects = await listS3Images(prefix);
    for (const obj of objects) {
      out.push({
        key: obj.key,
        label: l,
        ext: obj.ext,
        mime: obj.mime,
        etag: obj.etag,
        size: 0,
      });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Review (accept / reject)
// ---------------------------------------------------------------------------

export type ReviewAction = "accept" | "reject";

export interface ReviewResult {
  ok: boolean;
  sha1: string;
  action: ReviewAction;
  /** accept only: sha1 already in rotation. */
  duplicate?: boolean;
  /** accept only: destination key the object was promoted to. */
  promotedTo?: string;
  error?: string;
}

/**
 * Review a single pending object.
 *
 * - **accept**: SHA1 the bytes; if not a duplicate, copy to {ai,real}/ and
 *   index into the `images` table (entering rotation); delete from pending.
 * - **reject**: SHA1 the bytes; record in `rejected_images`; delete from
 *   pending. Future uploads/reindexes of the same content are auto-refused.
 */
export async function reviewPending(
  key: string,
  label: Label,
  action: ReviewAction,
): Promise<ReviewResult> {
  const bytes = await getS3Object(key);
  const sha1 = sha1Hex(bytes);

  if (action === "reject") {
    await rejectSha1(sha1, label, key);
    await deleteS3Object(key);
    return { ok: true, sha1, action };
  }

  // accept
  const { duplicate, id } = await indexPromoted(label, key, bytes, sha1);
  if (!duplicate) {
    const ext = extOf(key);
    const dstKey = `${acceptedPrefix(label)}${sha1}${ext}`;
    await copyS3Object(key, dstKey);
    await deleteS3Object(key);
    void id;
    return { ok: true, sha1, action, duplicate: false, promotedTo: dstKey };
  }
  // Already in rotation — just clear it from pending.
  await deleteS3Object(key);
  return { ok: true, sha1, action, duplicate: true };
}

/**
 * Index a promoted S3 object into the `images` table (entering rotation).
 * Dedup by sha1: if already present, returns duplicate:true without writing.
 */
async function indexPromoted(
  label: Label,
  key: string,
  bytes: Buffer,
  sha1: string,
): Promise<{ duplicate: boolean; id: string }> {
  const { images } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  const existing = await db
    .select({ id: images.id })
    .from(images)
    .where(eq(images.sha1, sha1))
    .limit(1);
  if (existing.length > 0) {
    return { duplicate: true, id: existing[0]!.id };
  }

  const ext = extOf(key);
  const mime = IMAGE_EXT[ext] ?? "application/octet-stream";
  const bucket = process.env.ROA_S3_BUCKET!.trim();
  const id = imageIdFromSha1(sha1);
  const now = Date.now();
  try {
    await db.insert(images).values({
      id,
      sha1,
      label,
      source: "s3",
      locator: s3Locator(bucket, key),
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
    const code = (err as { code?: string }).code;
    const msg = (err as { message?: string }).message ?? "";
    if (code === "SQLITE_CONSTRAINT" || /UNIQUE/i.test(msg)) {
      return { duplicate: true, id };
    }
    throw err;
  }
  await reloadCache();
  return { duplicate: false, id };
}

function extOf(key: string): string {
  const slash = key.lastIndexOf("/");
  const name = slash >= 0 ? key.slice(slash + 1) : key;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

// ---------------------------------------------------------------------------
// Future-dedup: clean up pending objects whose sha1 is already rejected
// ---------------------------------------------------------------------------

export async function cleanupRejectedPending(): Promise<{
  scanned: number;
  deleted: number;
}> {
  const items = await listPending();
  let deleted = 0;
  for (const item of items) {
    const bytes = await getS3Object(item.key);
    const sha1 = sha1Hex(bytes);
    if (await isSha1Rejected(sha1)) {
      await deleteS3Object(item.key);
      deleted++;
    }
  }
  return { scanned: items.length, deleted };
}
