import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const scores = sqliteTable("scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  score: integer("score").notNull(),
  correct: integer("correct").notNull(),
  total: integer("total").notNull(),
  mode: text("mode", { enum: ["easy", "hard"] }).notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Score = typeof scores.$inferSelect;

/**
 * Indexed image library. Source of truth for the catalog (replaces the
 * in-memory filesystem scan in catalog.ts). Keyed by an opaque HMAC id;
 * deduplicated by content SHA1.
 *
 * - `source`/`locator` describe where to fetch bytes from at serve time
 *   (`fs` → locator is an absolute path; `s3` → locator is `bucket/key`).
 * - `elo` / `appearances` / `fools` track per-image difficulty. See
 *   `src/lib/elo.ts`.
 * - `retired` is a manual operator flag only. Automatic retirement by ELO
 *   floor is a runtime check in pickByLabel, never persisted, so an image's
 *   ELO can recover.
 */
export const images = sqliteTable("images", {
  id: text("id").primaryKey(),
  sha1: text("sha1").notNull().unique(),
  label: text("label", { enum: ["ai", "real"] }).notNull(),
  source: text("source", { enum: ["fs", "s3"] }).notNull(),
  locator: text("locator").notNull(),
  ext: text("ext").notNull(),
  mime: text("mime").notNull(),
  elo: integer("elo").notNull().default(1000),
  appearances: integer("appearances").notNull().default(0),
  fools: integer("fools").notNull().default(0),
  retired: integer("retired", { mode: "boolean" }).notNull().default(false),
  indexedAt: integer("indexed_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type ImageRow = typeof images.$inferSelect;
export type NewImageRow = typeof images.$inferInsert;
