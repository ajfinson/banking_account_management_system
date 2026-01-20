import { z } from "zod";

const MAX_CENTS = Number.MAX_SAFE_INTEGER;

export const createAccountBodySchema = z.object({
  personId: z.string().min(1).max(255).regex(/^[a-zA-Z0-9_-]+$/, "Person ID must contain only letters, numbers, hyphens, and underscores"),
  dailyWithdrawalLimitCents: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_CENTS)
    .refine(Number.isSafeInteger),
  accountType: z.enum(["checking", "savings", "investment"]),
  initialBalanceCents: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_CENTS)
    .refine(Number.isSafeInteger)
    .optional()
});

export const amountBodySchema = z.object({
  amountCents: z
    .number()
    .int()
    .positive()
    .max(MAX_CENTS)
    .refine(Number.isSafeInteger)
});

export const accountParamsSchema = z.object({
  id: z.string().uuid()
});

export const idempotencyKeySchema = z.string().trim().min(1).max(255).optional();

export const statementQuerySchema = z
  .object({
    from: z.string().optional().refine(
      (val) => {
        if (!val) return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
        const [year, month, day] = val.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        // Check if date rolled over (e.g., Feb 30 -> Mar 2)
        return date.getUTCFullYear() === year && 
               date.getUTCMonth() === month - 1 && 
               date.getUTCDate() === day;
      },
      { message: "Invalid date" }
    ),
    to: z.string().optional().refine(
      (val) => {
        if (!val) return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
        const [year, month, day] = val.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        // Check if date rolled over (e.g., Feb 30 -> Mar 2)
        return date.getUTCFullYear() === year && 
               date.getUTCMonth() === month - 1 && 
               date.getUTCDate() === day;
      },
      { message: "Invalid date" }
    ),
    limit: z.coerce.number().int().positive().max(1000).optional(),
    offset: z.coerce.number().int().nonnegative().max(100000).optional()
  })
  .refine(
    (data) => !data.from || !data.to || data.from <= data.to,
    {
      message: "from date must be before to date",
      path: ["from"]
    }
  );

export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;
export type AmountBody = z.infer<typeof amountBodySchema>;
export type AccountParams = z.infer<typeof accountParamsSchema>;
export type StatementQuery = z.infer<typeof statementQuerySchema>;
