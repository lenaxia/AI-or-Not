import { requireAdmin } from "@/lib/admin-auth";
import { reindexAll } from "@/lib/catalog";

export async function POST(request: Request) {
  const guard = requireAdmin(request);
  if (guard) return guard;

  const result = await reindexAll();
  return Response.json(result);
}
