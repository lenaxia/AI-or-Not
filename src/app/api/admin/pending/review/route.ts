import { requireAdmin } from "@/lib/admin-auth";
import { reviewPending, pendingKeyLabel } from "@/lib/pending-review";
import { adminPendingReviewSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const guard = requireAdmin(request);
  if (guard) return guard;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid-body" }, { status: 400 });
  }

  const parsed = adminPendingReviewSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { key, label, action } = parsed.data;

  // Security boundary: the key must live under pending-review/{label}/.
  // Prevents the caller-supplied key from reaching S3 ops on arbitrary
  // objects (triage note on issue #35, point #2).
  const keyLabel = pendingKeyLabel(key);
  if (keyLabel === null || keyLabel !== label) {
    return Response.json({ error: "invalid-key" }, { status: 400 });
  }

  const result = await reviewPending(key, label, action);
  return Response.json(result);
}
