import "server-only";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const DB_URL =
  process.env.ROA_DB_URL?.trim() ||
  process.env.TURSO_DATABASE_URL?.trim() ||
  "file:./data/ai-or-not.db";

// For local file-backed SQLite, make sure the parent directory exists so the
// app works on first run with zero setup. Remote (Turso/Postgres) URLs skip this.
if (DB_URL.startsWith("file:")) {
  const file = DB_URL.slice("file:".length);
  const dir = path.dirname(path.resolve(file));
  fs.mkdirSync(dir, { recursive: true });
}

const client = createClient({
  url: DB_URL,
  authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
});

export const db = drizzle(client, { schema });

/**
 * Apply pending Drizzle migrations on first DB access. Uses drizzle-orm's
 * built-in migrator (traced into the standalone bundle — no drizzle-kit
 * needed at runtime). Idempotent: tracks applied migrations in
 * __drizzle_migrations. In dev the migrations live at ./drizzle; in the
 * Docker image they're copied to /app/drizzle (CWD is /app).
 *
 * Owned by the DB module so every code path that touches the schema
 * (catalog, leaderboard, admin) hits the same gate — not just the
 * leaderboard routes.
 */
let ensurePromise: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    }).then(() => undefined);
  }
  return ensurePromise;
}
