import {
  AccountBlockedError,
  DailyLimitExceededError,
  InsufficientFundsError,
  InvalidAmountError,
  NotFoundError
} from "../../common/errors";
import {
  Account,
  AccountsRepository,
  CreateAccountInput
} from "./repository";
import {
  Transaction,
  TransactionsRepository
} from "../transactions/transactions.repository";
import { MutexMap } from "../../infra/memory/mutex";
import { config } from "../../config";
import { getPool } from "../../infra/postgres/pool";
import type { PoolClient } from "pg";

export type CreateAccountRequest = {
  personId: string;
  dailyWithdrawalLimitCents: number;
  accountType: string;
  initialBalanceCents?: number;
};

export class AccountsService {
  constructor(
    private readonly accountsRepo: AccountsRepository,
    private readonly transactionsRepo: TransactionsRepository,
    private readonly mutexMap: MutexMap,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async withPostgresTransaction<T>(
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private mapAccountRow(row: {
    accountId: string;
    personId: string;
    balanceCents: number;
    dailyWithdrawalLimitCents: number;
    activeFlag: boolean;
    accountType: string;
    createDate: string;
  }): Account {
    return {
      accountId: row.accountId,
      personId: row.personId,
      balanceCents: Number(row.balanceCents),
      dailyWithdrawalLimitCents: Number(row.dailyWithdrawalLimitCents),
      activeFlag: row.activeFlag,
      accountType: row.accountType,
      createDate: row.createDate
    };
  }

  private async getAccountForUpdate(
    client: PoolClient,
    accountId: string
  ): Promise<Account> {
    const result = await client.query(
      `
      SELECT
        account_id AS "accountId",
        person_id AS "personId",
        balance_cents AS "balanceCents",
        daily_withdrawal_limit_cents AS "dailyWithdrawalLimitCents",
        active_flag AS "activeFlag",
        account_type AS "accountType",
        create_date AS "createDate"
      FROM account
      WHERE account_id = $1
      FOR UPDATE;
      `,
      [accountId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError();
    }

    return this.mapAccountRow(row);
  }

  async createAccount(input: CreateAccountRequest): Promise<Account> {
    const initialBalanceCents = input.initialBalanceCents ?? 0;
    if (initialBalanceCents < 0) {
      throw new InvalidAmountError("Initial balance must be non-negative");
    }

    const accountInput: CreateAccountInput = {
      personId: input.personId,
      dailyWithdrawalLimitCents: input.dailyWithdrawalLimitCents,
      accountType: input.accountType,
      balanceCents: initialBalanceCents,
      activeFlag: true,
      createDate: this.now().toISOString()
    };

    return this.accountsRepo.create(accountInput);
  }

  async getBalance(accountId: string): Promise<{ balanceCents: number }> {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    return { balanceCents: account.balanceCents };
  }

  async blockAccount(accountId: string): Promise<Account> {
    return this.accountsRepo.setActiveFlag(accountId, false);
  }

  async unblockAccount(accountId: string): Promise<Account> {
    return this.accountsRepo.setActiveFlag(accountId, true);
  }

  async deposit(
    accountId: string,
    amountCents: number
  ): Promise<{ balanceCents: number; transactionId: string }> {
    if (amountCents <= 0) {
      throw new InvalidAmountError();
    }

    const mutex = this.mutexMap.get(accountId);
    const release = await mutex.lock();
    try {
      if (config.REPO_PROVIDER === "postgres") {
        try {
          return await this.withPostgresTransaction(async (client) => {
            const account = await this.getAccountForUpdate(client, accountId);
            if (!account.activeFlag) {
              throw new AccountBlockedError();
            }

            const txResult = await client.query(
              `
              INSERT INTO transactions (
                transaction_id,
                account_id,
                value_cents,
                transaction_date
              )
              VALUES (
                gen_random_uuid(),
                $1, $2, $3
              )
              RETURNING transaction_id AS "transactionId";
              `,
              [accountId, amountCents, this.now().toISOString()]
            );

            const updatedResult = await client.query(
              `
              UPDATE account
              SET balance_cents = $2
              WHERE account_id = $1
              RETURNING
                account_id AS "accountId",
                person_id AS "personId",
                balance_cents AS "balanceCents",
                daily_withdrawal_limit_cents AS "dailyWithdrawalLimitCents",
                active_flag AS "activeFlag",
                account_type AS "accountType",
                create_date AS "createDate";
              `,
              [accountId, account.balanceCents + amountCents]
            );

            const updated = this.mapAccountRow(updatedResult.rows[0]);
            return {
              balanceCents: updated.balanceCents,
              transactionId: txResult.rows[0].transactionId as string
            };
          });
        } catch (error) {
          const err = error instanceof Error ? error : new Error("Unknown error");
          console.error("Deposit failed", {
            accountId,
            amountCents,
            error: err.message
          });
          throw error;
        }
      }

      const account = await this.accountsRepo.getById(accountId);
      if (!account) {
        throw new NotFoundError();
      }
      if (!account.activeFlag) {
        throw new AccountBlockedError();
      }

      const tx = await this.transactionsRepo.create({
        accountId,
        valueCents: amountCents,
        transactionDate: this.now().toISOString()
      });

      const updated = await this.accountsRepo.updateBalance(
        accountId,
        account.balanceCents + amountCents
      );

      return { balanceCents: updated.balanceCents, transactionId: tx.transactionId };
    } finally {
      release();
    }
  }

  async withdraw(
    accountId: string,
    amountCents: number
  ): Promise<{ balanceCents: number; transactionId: string }> {
    if (amountCents <= 0) {
      throw new InvalidAmountError();
    }

    const mutex = this.mutexMap.get(accountId);
    const release = await mutex.lock();
    try {
      if (config.REPO_PROVIDER === "postgres") {
        try {
          return await this.withPostgresTransaction(async (client) => {
            const account = await this.getAccountForUpdate(client, accountId);
            if (!account.activeFlag) {
              throw new AccountBlockedError();
            }
            if (account.balanceCents < amountCents) {
              throw new InsufficientFundsError();
            }

            const today = this.now().toISOString().slice(0, 10);
            const withdrawalsResult = await client.query(
              `
              SELECT COALESCE(SUM(ABS(value_cents)), 0) AS total
              FROM transactions
              WHERE account_id = $1
                AND value_cents < 0
                AND transaction_date::date = $2::date;
              `,
              [accountId, today]
            );

            const withdrawals = Number(withdrawalsResult.rows[0]?.total ?? 0);
            if (withdrawals + amountCents > account.dailyWithdrawalLimitCents) {
              throw new DailyLimitExceededError();
            }

            const txResult = await client.query(
              `
              INSERT INTO transactions (
                transaction_id,
                account_id,
                value_cents,
                transaction_date
              )
              VALUES (
                gen_random_uuid(),
                $1, $2, $3
              )
              RETURNING transaction_id AS "transactionId";
              `,
              [accountId, -amountCents, this.now().toISOString()]
            );

            const updatedResult = await client.query(
              `
              UPDATE account
              SET balance_cents = $2
              WHERE account_id = $1
              RETURNING
                account_id AS "accountId",
                person_id AS "personId",
                balance_cents AS "balanceCents",
                daily_withdrawal_limit_cents AS "dailyWithdrawalLimitCents",
                active_flag AS "activeFlag",
                account_type AS "accountType",
                create_date AS "createDate";
              `,
              [accountId, account.balanceCents - amountCents]
            );

            const updated = this.mapAccountRow(updatedResult.rows[0]);
            return {
              balanceCents: updated.balanceCents,
              transactionId: txResult.rows[0].transactionId as string
            };
          });
        } catch (error) {
          const err = error instanceof Error ? error : new Error("Unknown error");
          console.error("Withdraw failed", {
            accountId,
            amountCents,
            error: err.message
          });
          throw error;
        }
      }

      const account = await this.accountsRepo.getById(accountId);
      if (!account) {
        throw new NotFoundError();
      }
      if (!account.activeFlag) {
        throw new AccountBlockedError();
      }
      if (account.balanceCents < amountCents) {
        throw new InsufficientFundsError();
      }

      const today = this.now().toISOString().slice(0, 10);
      const withdrawals = await this.transactionsRepo.sumWithdrawalsForDay(
        accountId,
        today
      );

      if (withdrawals + amountCents > account.dailyWithdrawalLimitCents) {
        throw new DailyLimitExceededError();
      }

      const tx = await this.transactionsRepo.create({
        accountId,
        valueCents: -amountCents,
        transactionDate: this.now().toISOString()
      });

      const updated = await this.accountsRepo.updateBalance(
        accountId,
        account.balanceCents - amountCents
      );

      return { balanceCents: updated.balanceCents, transactionId: tx.transactionId };
    } finally {
      release();
    }
  }

  async statement(
    accountId: string,
    from?: string,
    to?: string,
    limit?: number,
    offset?: number
  ) {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError();
    }

    const allTransactions = await this.transactionsRepo.listByAccount(accountId);
    const periodTransactions = await this.transactionsRepo.listByAccount(
      accountId,
      from,
      to,
      limit,
      offset
    );

    const sumAll = allTransactions.reduce(
      (total, tx) => total + tx.valueCents,
      0
    );
    const initialBalance = account.balanceCents - sumAll;

    const sumBeforeFrom = from
      ? (await this.transactionsRepo.listByAccount(
          accountId,
          undefined,
          this.previousDay(from)
        )).reduce((total, tx) => total + tx.valueCents, 0)
      : 0;

    const openingBalance = from ? initialBalance + sumBeforeFrom : initialBalance;
    const periodSum = periodTransactions.reduce(
      (total, tx) => total + tx.valueCents,
      0
    );
    const closingBalance = openingBalance + periodSum;

    const totals = this.calculateTotals(periodTransactions);

    return {
      openingBalance,
      closingBalance,
      totalIn: totals.totalIn,
      totalOut: totals.totalOut,
      transactions: periodTransactions
    };
  }

  private calculateTotals(transactions: Transaction[]) {
    return transactions.reduce(
      (totals, tx) => {
        if (tx.valueCents >= 0) {
          totals.totalIn += tx.valueCents;
        } else {
          totals.totalOut += Math.abs(tx.valueCents);
        }
        return totals;
      },
      { totalIn: 0, totalOut: 0 }
    );
  }

  private previousDay(dateString: string): string {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }
}
