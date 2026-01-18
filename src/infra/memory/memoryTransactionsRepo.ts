import { randomUUID } from "crypto";
import {
  CreateTransactionInput,
  Transaction,
  TransactionsRepository
} from "../../modules/transactions/transactions.repository";

export class MemoryTransactionsRepository implements TransactionsRepository {
  private readonly transactions: Transaction[] = [];

  async create(input: CreateTransactionInput): Promise<Transaction> {
    const tx: Transaction = { ...input, transactionId: randomUUID() };
    this.transactions.push(tx);
    return tx;
  }

  async listByAccount(
    accountId: string,
    from?: string,
    to?: string
  ): Promise<Transaction[]> {
    return this.transactions
      .filter((tx) => tx.accountId === accountId)
      .filter((tx) => {
        const day = tx.transactionDate.slice(0, 10);
        if (from && day < from) {
          return false;
        }
        if (to && day > to) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
  }

  async sumWithdrawalsForDay(accountId: string, day: string): Promise<number> {
    return this.transactions
      .filter((tx) => tx.accountId === accountId)
      .filter((tx) => tx.transactionDate.slice(0, 10) === day)
      .filter((tx) => tx.valueCents < 0)
      .reduce((total, tx) => total + Math.abs(tx.valueCents), 0);
  }
}
