import { requireAdmin } from "@/lib/admin-auth";
import { cleanupRejectedPending } from "@/lib/pending-review";

export async function POST(request: Request) {
  const guard = requireAdmin(request);
  if (guard) return guard;

  const result = await cleanupRejectedPending();
  return Response.json(result);
}
