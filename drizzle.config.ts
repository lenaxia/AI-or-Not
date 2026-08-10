import { defineConfig } from "drizzle-kit";

const url =
  process.env.ROA_DB_URL?.trim() ||
  process.env.TURSO_DATABASE_URL?.trim() ||
  "file:./data/ai-or-not.db";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url,
    authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
  },
});
