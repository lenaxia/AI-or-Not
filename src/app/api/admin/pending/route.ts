import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listPending } from "@/lib/pending-review";
import { adminPendingQuerySchema } from "@/lib/schemas";

const PAGE_SIZE = 24;

export async function GET(request: NextRequest) {
  const guard = requireAdmin(request);
  if (guard) return guard;

  const parsed = adminPendingQuerySchema.safeParse({
    label: request.nextUrl.searchParams.get("label") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? "1",
  });
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Bounded S3 query: pass PAGE_SIZE as MaxKeys so we fetch one page,
  // not the entire prefix. The review UI drains the queue by deleting
  // items as they're triaged, so page=1 always surfaces the next batch.
  const items = await listPending(parsed.data.label, PAGE_SIZE);
  return Response.json({
    items: items.map((i) => ({
      key: i.key,
      label: i.label,
      ext: i.ext,
      mime: i.mime,
    })),
    total: items.length,
    page: 1,
    pageSize: PAGE_SIZE,
    hasMore: items.length === PAGE_SIZE,
  });
}

