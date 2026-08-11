import { guessBodySchema } from "@/lib/schemas";
import { decodeToken } from "@/lib/game";
import { recordGuess } from "@/lib/game-store";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAppearance, imageFooledPlayer } from "@/lib/elo";
import type { GuessResponse } from "@/lib/types";

const GUESS_LIMIT = { capacity: 30, perHour: 200, prefix: "guess" };

/** Derive each side's true label from the round truth (which sides are AI). */
function labelForSide(
  truth: "left" | "right" | "both" | "none",
  side: "left" | "right",
): "ai" | "real" {
  if (truth === "both") return "ai";
  if (truth === "none") return "real";
  return truth === side ? "ai" : "real";
}

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

  // Update ELO for both images in the round. Fire-and-forget: a failure here
  // must never break the guess response. Each update is a single atomic SQL
  // statement (no RMW race — see elo.ts).
  const guess = parsed.data.guess;
  const leftLabel = labelForSide(payload.t, "left");
  const rightLabel = labelForSide(payload.t, "right");
  Promise.allSettled([
    recordAppearance(payload.l, imageFooledPlayer(leftLabel, "left", guess)),
    recordAppearance(payload.r, imageFooledPlayer(rightLabel, "right", guess)),
  ]).catch(() => {});

  const result: GuessResponse = {
    correct: isCorrect,
    truth: payload.t,
    correctSoFar: state.correct,
    totalSoFar: state.total,
  };
  return Response.json(result);
}
