import type { NextRequest } from "next/server";
import type { RoundResponse } from "@/lib/types";
import { buildRound } from "@/lib/game";
import { getCounts } from "@/lib/catalog";
import { resolveGame, recordRound } from "@/lib/game-store";
import { modeSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const parsed = modeSchema.safeParse(
    request.nextUrl.searchParams.get("mode") ?? "easy",
  );
  const mode = parsed.success ? parsed.data : "easy";

  const gameToken = request.nextUrl.searchParams.get("gameToken") ?? "";
  const state = gameToken ? resolveGame(gameToken) : null;
  const seenIds = state?.seenIds;

  const built = await buildRound(mode, seenIds);

  if (!built) {
    const counts = await getCounts();
    return Response.json(
      {
        error: "not-enough-images",
        message:
          "Add at least 10 images to both images/ai and images/real to play a full 10-round game.",
        counts,
      },
      { status: 503 },
    );
  }

  // Record the round in the game state (truth + dedup tracking).
  if (state && gameToken) {
    recordRound(gameToken, {
      leftId: built.response.leftId,
      rightId: built.response.rightId,
      truth: built.truth,
    });
  }

  const payload: RoundResponse = built.response;
  return Response.json(payload);
}
