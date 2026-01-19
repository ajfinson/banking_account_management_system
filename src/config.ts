import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default("0.0.0.0"),
    REPO_PROVIDER: z.enum(["memory", "postgres"]).default("memory"),
    DATABASE_URL: z.string().optional(),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000)
  })
  .superRefine((value, ctx) => {
    if (value.REPO_PROVIDER === "postgres" && !value.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DATABASE_URL is required when REPO_PROVIDER=postgres",
        path: ["DATABASE_URL"]
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export const config: AppConfig = envSchema.parse(process.env);