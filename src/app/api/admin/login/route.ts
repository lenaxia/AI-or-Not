import { adminLogin, adminEnabled, adminSessionCookie } from "@/lib/admin-auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

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

  const pw = typeof (raw as { password?: unknown })?.password === "string"
    ? (raw as { password: string }).password
    : "";
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
