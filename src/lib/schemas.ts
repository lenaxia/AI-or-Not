import { z } from "zod";

export const modeSchema = z.enum(["easy", "hard"]);

export const guessBodySchema = z.object({
  token: z.string().min(1),
  guess: z.enum(["left", "right", "both", "none"]),
});

export const submitScoreBodySchema = z.object({
  correct: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  mode: modeSchema,
}).refine((d) => d.correct <= d.total, {
  message: "correct cannot exceed total",
  path: ["correct"],
});
