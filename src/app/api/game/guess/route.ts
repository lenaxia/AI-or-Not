import { guessBodySchema } from "@/lib/schemas";
import { decodeToken } from "@/lib/game";
import { recordGuess } from "@/lib/game-store";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import type { GuessResponse } from "@/lib/types";

const GUESS_LIMIT = { capacity: 30, perHour: 200, prefix: "guess" };

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit(ip, GUESS_LIMIT);
  if (!rl.allowed) {
    return Response.json(
      { error: "rate-limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid-body" }, { status: 400 });
  }

  const parsed = guessBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const payload = decodeToken(parsed.data.token);
  if (!payload) {
    return Response.json({ error: "invalid-token" }, { status: 400 });
  }

  const isCorrect = payload.t === parsed.data.guess;
  const state = recordGuess(parsed.data.gameToken, isCorrect);
  if (!state) {
    return Response.json(
      { error: "invalid-game-token", message: "Game session expired or invalid." },
      { status: 400 },
    );
  }

  const result: GuessResponse = {
    correct: isCorrect,
    truth: payload.t,
    correctSoFar: state.correct,
    totalSoFar: state.total,
  };
  return Response.json(result);
}
