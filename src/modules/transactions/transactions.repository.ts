export type Transaction = {
  transactionId: string;
  accountId: string;
  valueCents: number;
  transactionDate: string;
};

export type CreateTransactionInput = Omit<Transaction, "transactionId">;

export interface TransactionsRepository {
  create(input: CreateTransactionInput): Promise<Transaction>;
  listByAccount(
    accountId: string,
    from?: string,
    to?: string
  ): Promise<Transaction[]>;
  sumWithdrawalsForDay(accountId: string, day: string): Promise<number>;
}
