import "server-only";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  type _Object,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

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

export interface S3Config {
  bucket: string;
  region?: string;
  endpoint?: string;
  forcePathStyle: boolean;
}

export interface S3Image {
  key: string;
  ext: string;
  mime: string;
  /** S3 ETag — for single-part uploads this is the MD5 of the content. */
  etag: string;
}

let client: S3Client | null = null;

function cfg(): S3Config | null {
  const bucket = process.env.ROA_S3_BUCKET?.trim();
  if (!bucket) return null;
  return {
    bucket,
    region: process.env.ROA_S3_REGION?.trim() || undefined,
    endpoint: process.env.ROA_S3_ENDPOINT?.trim() || undefined,
    forcePathStyle:
      (process.env.ROA_S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
  };
}

/** True when the bucket env var is set (S3 source is active). */
export function s3Enabled(): boolean {
  return cfg() !== null;
}

/** Exposed for tests to inject a mock client. */
export function __setS3ClientForTests(mock: S3Client | null): void {
  client = mock;
}

function getClient(): S3Client {
  if (client) return client;
  const c = cfg();
  if (!c) throw new Error("S3 not configured (ROA_S3_BUCKET unset)");
  client = new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    forcePathStyle: c.forcePathStyle,
  });
  return client;
}

async function streamToBuffer(stream: Readable | ReadableStream): Promise<Buffer> {
  if (stream instanceof ReadableStream) {
    const reader = (stream as ReadableStream).getReader();
    const chunks: Buffer[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** List all image objects under a prefix. Paginated. */
export async function listS3Images(prefix: string): Promise<S3Image[]> {
  const c = cfg()!;
  const s3 = getClient();
  const out: S3Image[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: c.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of (res.Contents ?? []) as _Object[]) {
      if (!obj.Key) continue;
      const ext = extOf(obj.Key);
      const mime = IMAGE_EXT[ext];
      if (!mime) continue;
      out.push({
        key: obj.Key,
        ext,
        mime,
        etag: (obj.ETag ?? "").replace(/^"|"$/g, ""),
      });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

function extOf(key: string): string {
  const slash = key.lastIndexOf("/");
  const name = slash >= 0 ? key.slice(slash + 1) : key;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/** Fetch the full bytes of an object. */
export async function getS3Object(key: string): Promise<Buffer> {
  const c = cfg()!;
  const s3 = getClient();
  const res = await s3.send(new GetObjectCommand({ Bucket: c.bucket, Key: key }));
  if (!res.Body) throw new Error(`empty body for s3://${c.bucket}/${key}`);
  return streamToBuffer(res.Body as Readable);
}

export function s3Locator(bucket: string, key: string): string {
  return `${bucket}/${key}`;
}

export function parseLocator(locator: string): { bucket: string; key: string } {
  const slash = locator.indexOf("/");
  return { bucket: locator.slice(0, slash), key: locator.slice(slash + 1) };
}
