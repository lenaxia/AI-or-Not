import "server-only";
import { timingSafeEqual } from "node:crypto";
import { sign, verify, hmacHex } from "./crypto";

/**
 * Minimal admin auth for a fun project. Single shared password via env var.
 * NOT a substitute for real auth — see docs/backlog/epic01-s3-elo-admin.
 */

const COOKIE_NAME = "aionot_admin";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h

interface SessionPayload {
  /** Discriminator: prevents round/game tokens (which share the HMAC key) from validating as admin sessions. */
  kind: "admin";
  admin: true;
  exp: number;
}

function password(): string | undefined {
  const p = process.env.ROA_ADMIN_PASSWORD;
  return p && p.length > 0 ? p : undefined;
}

/** Admin portal is fully disabled (404) when the password is unset. */
export function adminEnabled(): boolean {
  return password() !== undefined;
}

/**
 * Constant-time password comparison. Both sides are HMAC'd first so the
 * comparison is over equal-length digests — sidesteps the timing leak
 * `timingSafeEqual` has on unequal-length inputs.
 */
function safeEqual(a: string, b: string): boolean {
  const ah = hmacHex(a);
  const bh = hmacHex(b);
  const ab = Buffer.from(ah);
  const bb = Buffer.from(bh);
  return timingSafeEqual(ab, bb);
}

/** Returns a signed session cookie value if the password matches, else null. */
export function adminLogin(pw: string): string | null {
  const expected = password();
  if (!expected) return null;
  if (!safeEqual(pw, expected)) return null;
  return sign<SessionPayload>({
    kind: "admin",
    admin: true,
    exp: Date.now() + SESSION_TTL_MS,
  });
}

/**
 * True if the cookie value is a valid, unexpired admin session token.
 *
 * Validates the PAYLOAD SHAPE, not just the HMAC signature — round tokens
 * and game tokens are signed by the same `sign()` with the same
 * `ROA_SECRET`, so signature alone is not a sufficient guarantee. The
 * `kind: "admin"` discriminator + explicit `typeof exp === "number"` check
 * prevent any non-admin token from passing (a non-admin payload either
 * lacks `kind`, has a different `kind`, or lacks a numeric `exp`).
 */
export function adminVerify(
  cookieValue: string | null | undefined,
): boolean {
  if (!cookieValue) return false;
  const payload = verify<SessionPayload>(cookieValue);
  if (!payload) return false;
  if (payload.kind !== "admin") return false;
  if (payload.admin !== true) return false;
  if (typeof payload.exp !== "number" || payload.exp <= Date.now()) {
    return false;
  }
  return true;
}

export function adminCookieName(): string {
  return COOKIE_NAME;
}

export function adminLogoutCookie(): string {
  // Expires in the past → browser deletes it.
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function adminSessionCookie(value: string): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

/**
 * Require admin for a Route Handler. Returns null if authorized, else a
 * Response suitable for direct return (401 or 404).
 */
export function requireAdmin(request: Request): Response | null {
  if (!adminEnabled()) {
    // Hide the endpoint entirely when the portal is disabled.
    return new Response("Not found", { status: 404 });
  }
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!adminVerify(match?.[1])) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
