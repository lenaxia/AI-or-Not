import { guessBodySchema } from "@/lib/schemas";
import { decodeToken } from "@/lib/game";
import type { GuessResponse } from "@/lib/types";

export async function POST(request: Request) {
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

  const result: GuessResponse = {
    correct: payload.t === parsed.data.guess,
    truth: payload.t,
  };
  return Response.json(result);
}
