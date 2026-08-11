import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adminEnabled,
  adminLogin,
  adminVerify,
  adminCookieName,
  adminLogoutCookie,
  adminSessionCookie,
  requireAdmin,
} from "./admin-auth";

beforeEach(() => {
  delete process.env.ROA_ADMIN_PASSWORD;
});

afterEach(() => {
  delete process.env.ROA_ADMIN_PASSWORD;
});

describe("adminEnabled", () => {
  it("is disabled when the env var is unset", () => {
    expect(adminEnabled()).toBe(false);
  });

  it("is disabled when the env var is empty", () => {
    process.env.ROA_ADMIN_PASSWORD = "";
    expect(adminEnabled()).toBe(false);
  });

  it("is enabled when set to a non-empty value", () => {
    process.env.ROA_ADMIN_PASSWORD = "hunter2";
    expect(adminEnabled()).toBe(true);
  });
});

describe("adminLogin", () => {
  it("returns null when admin is disabled", () => {
    expect(adminLogin("anything")).toBeNull();
  });

  it("returns null for a wrong password", () => {
    process.env.ROA_ADMIN_PASSWORD = "hunter2";
    expect(adminLogin("wrong")).toBeNull();
  });

  it("returns null for an empty password", () => {
    process.env.ROA_ADMIN_PASSWORD = "hunter2";
    expect(adminLogin("")).toBeNull();
  });

  it("returns a token for the right password", () => {
    process.env.ROA_ADMIN_PASSWORD = "hunter2";
    const tok = adminLogin("hunter2");
    expect(tok).toBeTruthy();
    expect(typeof tok).toBe("string");
  });
});

describe("adminVerify", () => {
  it("rejects null / undefined / empty", () => {
    expect(adminVerify(null)).toBe(false);
    expect(adminVerify(undefined)).toBe(false);
    expect(adminVerify("")).toBe(false);
  });

  it("rejects garbage", () => {
    expect(adminVerify("garbage")).toBe(false);
  });

  it("rejects a tampered token", () => {
    process.env.ROA_ADMIN_PASSWORD = "hunter2";
    const tok = adminLogin("hunter2")!;
    const tampered = tok.slice(0, -1) + "X";
    expect(adminVerify(tampered)).toBe(false);
  });

  it("accepts a freshly-issued token", () => {
    process.env.ROA_ADMIN_PASSWORD = "hunter2";
    const tok = adminLogin("hunter2");
    expect(adminVerify(tok)).toBe(true);
  });

  it("rejects an expired token", async () => {
    process.env.ROA_ADMIN_PASSWORD = "hunter2";
    // Sign a token with exp in the past; adminVerify must reject it.
    const { sign } = await import("./crypto");
    const pastToken = sign({ admin: true, exp: Date.now() - 1 });
    expect(adminVerify(pastToken)).toBe(false);
  });
});

describe("cookie helpers", () => {
  it("exposes a stable cookie name", () => {
    expect(adminCookieName()).toBe("aionot_admin");
  });

  it("session cookie is HttpOnly and carries the value", () => {
    const c = adminSessionCookie("tok123");
    expect(c).toContain("aionot_admin=tok123");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Max-Age=");
  });

  it("logout cookie has Max-Age=0", () => {
    const c = adminLogoutCookie();
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("HttpOnly");
  });
});

describe("requireAdmin", () => {
  it("returns 404 when admin is disabled", () => {
    const r = requireAdmin(new Request("https://x/"));
    expect(r).not.toBeNull();
    expect(r!.status).toBe(404);
  });

  it("returns 401 when enabled but no cookie", () => {
    process.env.ROA_ADMIN_PASSWORD = "hunter2";
    const r = requireAdmin(new Request("https://x/"));
    expect(r).not.toBeNull();
    expect(r!.status).toBe(401);
  });

  it("returns 401 for an invalid cookie", () => {
    process.env.ROA_ADMIN_PASSWORD = "hunter2";
    const r = requireAdmin(
      new Request("https://x/", {
        headers: { cookie: "aionot_admin=garbage" },
      }),
    );
    expect(r).not.toBeNull();
    expect(r!.status).toBe(401);
  });

  it("returns null when the cookie is a valid session", () => {
    process.env.ROA_ADMIN_PASSWORD = "hunter2";
    const tok = adminLogin("hunter2")!;
    const r = requireAdmin(
      new Request("https://x/", {
        headers: { cookie: `aionot_admin=${tok}` },
      }),
    );
    expect(r).toBeNull();
  });
});
