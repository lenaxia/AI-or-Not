import { adminLogin, adminEnabled, adminSessionCookie } from "@/lib/admin-auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { adminLoginBodySchema } from "@/lib/schemas";

const LOGIN_LIMIT = { capacity: 5, perHour: 20, prefix: "admin-login" };

export async function POST(request: Request) {
  if (!adminEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit(ip, LOGIN_LIMIT);
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

  const parsed = adminLoginBodySchema.safeParse(raw);
  // Treat a parse failure as wrong password (don't leak whether the body
  // was well-formed vs. the credentials were wrong).
  const pw = parsed.success ? parsed.data.password : "";
  const token = adminLogin(pw);
  if (!token) {
    return Response.json(
      { error: "invalid-credentials" },
      { status: 401 },
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": adminSessionCookie(token),
    },
  });
}
