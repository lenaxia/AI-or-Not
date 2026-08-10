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
