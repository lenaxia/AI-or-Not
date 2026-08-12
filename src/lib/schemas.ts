import { z } from "zod";

export const modeSchema = z.enum(["easy", "hard"]);

export const startBodySchema = z.object({
  mode: modeSchema,
});

export const guessBodySchema = z.object({
  token: z.string().min(1),
  guess: z.enum(["left", "right"]),
  gameToken: z.string().min(1),
  timeMs: z.number().int().nonnegative().optional(),
});

export const submitScoreBodySchema = z.object({
  gameToken: z.string().min(1),
});

export const adminLoginBodySchema = z.object({
  password: z.string().min(1),
});

export const adminImageActionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["retire", "reactivate", "delete", "delete-source"]),
});

export const adminImagesQuerySchema = z.object({
  label: z.enum(["ai", "real"]).optional(),
  status: z.enum(["active", "retired"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z
    .preprocess(
      (v) => (v == null ? 100 : Number(v)),
      z.number().int().transform((n) =>
        [24, 50, 100, 200].includes(n) ? n : 100,
      ),
    ),
});

export const adminPendingQuerySchema = z.object({
  label: z.enum(["ai", "real"]).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const adminPendingReviewSchema = z.object({
  key: z.string().min(1),
  label: z.enum(["ai", "real"]),
  action: z.enum(["accept", "reject"]),
});

export const adminPendingImgQuerySchema = z.object({
  key: z.string().min(1),
});
