import { submitScoreBodySchema } from "@/lib/schemas";
import { getPreview, submitScore } from "@/lib/leaderboard";

export async function GET() {
  const preview = await getPreview();
  return Response.json(preview);
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid-body" }, { status: 400 });
  }

  const parsed = submitScoreBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const stats = await submitScore(parsed.data);
  return Response.json(stats);
}
