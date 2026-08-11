import { z } from "zod";

export const modeSchema = z.enum(["easy", "hard"]);

export const startBodySchema = z.object({
  mode: modeSchema,
});

export const guessBodySchema = z.object({
  token: z.string().min(1),
  guess: z.enum(["left", "right", "both", "none"]),
  gameToken: z.string().min(1),
});

export const submitScoreBodySchema = z.object({
  gameToken: z.string().min(1),
});

export const adminLoginBodySchema = z.object({
  password: z.string().min(1),
});

