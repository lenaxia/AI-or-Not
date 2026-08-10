import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_SECRET = "realorai-dev-secret-CHANGE-ME";

export function getSecret(): string {
  return process.env.ROA_SECRET?.trim() || DEFAULT_SECRET;
}

export function hmacHex(input: string): string {
  return createHmac("sha256", getSecret()).update(input).digest("hex");
}

export function opaqueId(input: string): string {
  return hmacHex(input).slice(0, 24);
}

export function sign<T>(payload: T): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = hmacHex(body).slice(0, 32);
  return `${body}.${mac}`;
}

export function verify<T>(token: string): T | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = hmacHex(body).slice(0, 32);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
