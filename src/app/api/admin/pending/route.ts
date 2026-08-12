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

  const all = await listPending(parsed.data.label);
  const total = all.length;
  const start = (parsed.data.page - 1) * PAGE_SIZE;
  const items = all.slice(start, start + PAGE_SIZE);
  return Response.json({
    items: items.map((i) => ({
      key: i.key,
      label: i.label,
      ext: i.ext,
      mime: i.mime,
    })),
    total,
    page: parsed.data.page,
    pageSize: PAGE_SIZE,
  });
}
