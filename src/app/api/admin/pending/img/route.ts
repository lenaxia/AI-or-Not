import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { pendingKeyLabel } from "@/lib/pending-review";
import { getS3Object } from "@/lib/s3";
import { adminPendingImgQuerySchema } from "@/lib/schemas";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

export async function GET(request: NextRequest) {
  const guard = requireAdmin(request);
  if (guard) return guard;

  const parsed = adminPendingImgQuerySchema.safeParse({
    key: request.nextUrl.searchParams.get("key") ?? "",
  });
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Security boundary: never pass a caller-supplied key to S3 unless it
  // lives under pending-review/{ai,real}/. Without this the endpoint would
  // be a "read any object in the bucket" primitive (triage note, issue #35).
  if (pendingKeyLabel(parsed.data.key) === null) {
    return new Response("Not found", { status: 404 });
  }

  let data: Buffer;
  try {
    data = await getS3Object(parsed.data.key);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const slash = parsed.data.key.lastIndexOf("/");
  const name = slash >= 0 ? parsed.data.key.slice(slash + 1) : parsed.data.key;
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
