export type Transaction = {
  transactionId: string;
  accountId: string;
  valueCents: number;
  transactionDate: string;
  balanceAfter: number;
  idempotencyKey?: string;
};

export type CreateTransactionInput = Omit<Transaction, "transactionId">;

export interface TransactionsRepository {
  create(input: CreateTransactionInput): Promise<Transaction>;
  findByIdempotencyKey(idempotencyKey: string): Promise<Transaction | null>;
  listByAccount(
    accountId: string,
    from?: string,
    to?: string,
    limit?: number,
    offset?: number
  ): Promise<Transaction[]>;
  countByAccount(accountId: string, from?: string, to?: string): Promise<number>;
  sumByAccountRange(
    accountId: string,
    from?: string,
    to?: string
  ): Promise<{ totalIn: number; totalOut: number; totalNet: number }>;
  sumWithdrawalsForDay(accountId: string, day: string): Promise<number>;
}
