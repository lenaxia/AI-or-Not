import "server-only";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const DB_URL =
  process.env.ROA_DB_URL?.trim() ||
  process.env.TURSO_DATABASE_URL?.trim() ||
  "file:./data/realorai.db";

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
