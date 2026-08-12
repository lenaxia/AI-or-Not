import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listImages, setImageRetired, deleteImage, deleteImageAndSource } from "@/lib/catalog";
import { adminImagesQuerySchema, adminImageActionSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const guard = requireAdmin(request);
  if (guard) return guard;

  const parsed = adminImagesQuerySchema.safeParse({
    label: request.nextUrl.searchParams.get("label") ?? undefined,
    status: request.nextUrl.searchParams.get("status") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? "1",
    pageSize: request.nextUrl.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const pageSize = parsed.data.pageSize;
  const { rows, total } = await listImages({
    label: parsed.data.label,
    retired: parsed.data.status === "retired" ? true : parsed.data.status === "active" ? false : undefined,
    page: parsed.data.page,
    pageSize,
  });
  return Response.json({
    rows: rows.map((r) => ({
      id: r.id,
      sha1: r.sha1,
      label: r.label,
      source: r.source,
      ext: r.ext,
      elo: r.elo,
      appearances: r.appearances,
      fools: r.fools,
      retired: r.retired,
    })),
    total,
    page: parsed.data.page,
    pageSize,
  });
}

export async function POST(request: Request) {
  const guard = requireAdmin(request);
  if (guard) return guard;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid-body" }, { status: 400 });
  }

  const parsed = adminImageActionSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { id, action } = parsed.data;
  if (action === "delete") {
    const ok = await deleteImage(id);
    if (!ok) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({ ok: true });
  }
  if (action === "delete-source") {
    const result = await deleteImageAndSource(id);
    if (!result.rowDeleted) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({
      ok: true,
      sourceDeleted: result.sourceDeleted,
      ...(result.sourceError ? { sourceError: result.sourceError } : {}),
    });
  }
  let ok: boolean;
  switch (action) {
    case "retire":
      ok = await setImageRetired(id, true);
      break;
    case "reactivate":
      ok = await setImageRetired(id, false);
      break;
    default:
      return Response.json({ error: "invalid-action" }, { status: 400 });
  }
  if (!ok) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
