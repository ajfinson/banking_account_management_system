import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default("0.0.0.0"),
    REPO_PROVIDER: z.enum(["memory", "postgres"]).default("memory"),
    DATABASE_URL: z.string().optional(),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    DB_POOL_SIZE: z.coerce.number().int().positive().default(20),
    RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(50),
    BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1048576),
    MAX_PARAM_LENGTH: z.coerce.number().int().positive().default(500),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    DAILY_LIMIT_TIMEZONE: z.string().default("UTC")
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