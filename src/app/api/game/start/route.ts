import { startBodySchema } from "@/lib/schemas";
import { startGame } from "@/lib/game-store";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import type { StartResponse } from "@/lib/types";

const START_LIMIT = { capacity: 5, perHour: 20, prefix: "start" };

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit(ip, START_LIMIT);
  if (!rl.allowed) {
    return Response.json(
      { error: "rate-limited", message: "Too many games started. Wait a bit." },
      { status: 429, headers: { "Retry-After": "300" } },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid-body" }, { status: 400 });
  }

  const parsed = startBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { gameToken } = startGame(parsed.data.mode);
  const response: StartResponse = { gameToken, mode: parsed.data.mode };
  return Response.json(response);
}
