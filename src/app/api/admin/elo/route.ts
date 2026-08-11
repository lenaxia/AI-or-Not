import { requireAdmin } from "@/lib/admin-auth";
import { listByElo } from "@/lib/catalog";

export async function GET(request: Request) {
  const guard = requireAdmin(request);
  if (guard) return guard;

  const { ai, real } = await listByElo();
  const trim = (r: typeof ai) =>
    r.map((e) => ({
      id: e.id,
      sha1: e.sha1,
      label: e.label,
      elo: e.elo,
      appearances: e.appearances,
      fools: e.fools,
      retired: e.retired,
    }));
  return Response.json({ ai: trim(ai), real: trim(real) });
}
