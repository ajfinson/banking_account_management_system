import { z } from "zod";

export const createAccountBodySchema = z.object({
  personId: z.string().min(1),
  dailyWithdrawalLimitCents: z.number().int().nonnegative(),
  accountType: z.enum(["checking", "savings", "investment"]),
  initialBalanceCents: z.number().int().nonnegative().optional()
});

export const amountBodySchema = z.object({
  amountCents: z.number().int().positive()
});

export const accountParamsSchema = z.object({
  id: z.string().min(1)
});

export const statementQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.coerce.number().int().positive().optional(),
    offset: z.coerce.number().int().nonnegative().optional()
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
