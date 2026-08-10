import { submitScoreBodySchema } from "@/lib/schemas";
import { consumeGame } from "@/lib/game-store";
import { getPreview, submitScore } from "@/lib/leaderboard";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const SUBMIT_LIMIT = { capacity: 3, perHour: 10, prefix: "submit" };

export async function GET() {
  const preview = await getPreview();
  return Response.json(preview);
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit(ip, SUBMIT_LIMIT);
  if (!rl.allowed) {
    return Response.json(
      { error: "rate-limited" },
      { status: 429, headers: { "Retry-After": "600" } },
    );
  }

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

  // Consume (read + delete) the game state. The client cannot resubmit
  // the same token, and the score is read from server-tracked state —
  // the request body never carried a score.
  const game = consumeGame(parsed.data.gameToken);
  if (!game) {
    return Response.json(
      { error: "invalid-game-token", message: "Game session expired, already submitted, or invalid." },
      { status: 400 },
    );
  }

  // Require at least 1 round played to prevent trivial 0/0 submissions.
  if (game.total < 1) {
    return Response.json(
      { error: "no-rounds-played" },
      { status: 400 },
    );
  }

  const stats = await submitScore(game);
  return Response.json(stats);
}
