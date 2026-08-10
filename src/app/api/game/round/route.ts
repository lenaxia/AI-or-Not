import type { NextRequest } from "next/server";
import type { RoundResponse } from "@/lib/types";
import { buildRound } from "@/lib/game";
import { getCounts } from "@/lib/catalog";
import { modeSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const parsed = modeSchema.safeParse(
    request.nextUrl.searchParams.get("mode") ?? "easy",
  );
  const mode = parsed.success ? parsed.data : "easy";

  const built = await buildRound(mode);

  if (!built) {
    const counts = await getCounts();
    return Response.json(
      {
        error: "not-enough-images",
        message:
          "Add at least 2 images to both images/ai and images/real to play.",
        counts,
      },
      { status: 503 },
    );
  }

  const payload: RoundResponse = built.response;
  return Response.json(payload);
}
