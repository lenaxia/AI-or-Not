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

export const adminImageActionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["retire", "reactivate", "delete"]),
});

export const adminImagesQuerySchema = z.object({
  label: z.enum(["ai", "real"]).optional(),
  status: z.enum(["active", "retired"]).optional(),
  page: z.coerce.number().int().positive().default(1),
});
