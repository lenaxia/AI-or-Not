import { createHash } from "node:crypto";
import { opaqueId } from "./crypto";

/**
 * SHA1 of raw file bytes. Used for content-addressed dedup in the `images`
 * table. Hex, 40 chars.
 */
export function sha1Hex(data: Buffer | Uint8Array): string {
  return createHash("sha1").update(data).digest("hex");
}

/**
 * Public opaque image id = HMAC-SHA256(contentSha1)[:24]. Stable across
 * renames and source moves (path no longer participates in the id, unlike
 * the original catalog which HMAC'd the on-disk path).
 */
export function imageIdFromSha1(sha1: string): string {
  return opaqueId(sha1);
}
