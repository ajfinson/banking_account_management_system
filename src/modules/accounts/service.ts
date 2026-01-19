import {
  AccountBlockedError,
  AlreadyBlockedError,
  AlreadyUnblockedError,
  DailyLimitExceededError,
  InsufficientFundsError,
  InvalidAmountError,
  NotFoundError,
  PersonNotFoundError
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
  private static readonly MAX_CENTS = 2_000_000_000;
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
    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        const pgError = error as { code?: string };
        attempt += 1;
        if (pgError.code && this.isRetryablePgError(pgError.code) && attempt < maxAttempts) {
          console.warn("Retrying transaction", { attempt, code: pgError.code });
          await this.delay(50 * attempt);
          continue;
        }
        throw error;
      } finally {
        client.release();
      }
    }

    throw new Error("Transaction retry attempts exhausted");
  }

  private isRetryablePgError(code: string): boolean {
    return code === "40001" || code === "40P01" || code === "55P03" || code === "57P03";
  }

  private async delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    this.validateCents(initialBalanceCents, "Initial balance");
    this.validateCents(input.dailyWithdrawalLimitCents, "Daily limit");

    const accountInput: CreateAccountInput = {
      personId: input.personId,
      dailyWithdrawalLimitCents: input.dailyWithdrawalLimitCents,
      accountType: input.accountType,
      balanceCents: initialBalanceCents,
      activeFlag: true,
      createDate: this.now().toISOString()
    };

    if (config.REPO_PROVIDER === "postgres") {
      try {
        return await this.withPostgresTransaction(async (client) => {
          const result = await client.query(
            `
            INSERT INTO account (
              account_id,
              person_id,
              balance_cents,
              daily_withdrawal_limit_cents,
              active_flag,
              account_type,
              create_date
            )
            VALUES (
              gen_random_uuid(),
              $1, $2, $3, $4, $5, $6
            )
            RETURNING
              account_id AS "accountId",
              person_id AS "personId",
              balance_cents AS "balanceCents",
              daily_withdrawal_limit_cents AS "dailyWithdrawalLimitCents",
              active_flag AS "activeFlag",
              account_type AS "accountType",
              create_date AS "createDate";
            `,
            [
              accountInput.personId,
              accountInput.balanceCents,
              accountInput.dailyWithdrawalLimitCents,
              accountInput.activeFlag,
              accountInput.accountType,
              accountInput.createDate
            ]
          );

          const account = this.mapAccountRow(result.rows[0]);

          if (initialBalanceCents > 0) {
            await client.query(
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
              );
              `,
              [account.accountId, initialBalanceCents, accountInput.createDate]
            );
          }

          return account;
        });
      } catch (error) {
        const pgError = error as { code?: string };
        if (pgError.code === "23503") {
          throw new PersonNotFoundError();
        }
        throw error;
      }
    }

    const account = await this.accountsRepo.create(accountInput);
    if (initialBalanceCents > 0) {
      await this.transactionsRepo.create({
        accountId: account.accountId,
        valueCents: initialBalanceCents,
        transactionDate: accountInput.createDate
      });
    }

    return account;
  }

  async getBalance(accountId: string): Promise<{ balanceCents: number }> {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    return { balanceCents: account.balanceCents };
  }

  async blockAccount(accountId: string): Promise<Account> {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    if (!account.activeFlag) {
      throw new AlreadyBlockedError();
    }
    const updated = await this.accountsRepo.setActiveFlag(accountId, false);
    console.info("Account blocked", { accountId });
    return updated;
  }

  async unblockAccount(accountId: string): Promise<Account> {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    if (account.activeFlag) {
      throw new AlreadyUnblockedError();
    }
    const updated = await this.accountsRepo.setActiveFlag(accountId, true);
    console.info("Account unblocked", { accountId });
    return updated;
  }

  async deposit(
    accountId: string,
    amountCents: number
  ): Promise<{ balanceCents: number; transactionId: string }> {
    if (amountCents <= 0) {
      throw new InvalidAmountError();
    }
    this.validateCents(amountCents, "Amount");

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
    this.validateCents(amountCents, "Amount");

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
              const deficit = amountCents - account.balanceCents;
              throw new InsufficientFundsError(
                `Insufficient funds: short by ${deficit} cents`
              );
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
        const deficit = amountCents - account.balanceCents;
        throw new InsufficientFundsError(
          `Insufficient funds: short by ${deficit} cents`
        );
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
    const totalCount = await this.transactionsRepo.countByAccount(
      accountId,
      from,
      to
    );

    const sumBeforeFrom = from
      ? (await this.transactionsRepo.sumByAccountRange(
          accountId,
          undefined,
          this.previousDay(from)
        )).totalNet
      : 0;

    const openingBalance = from ? sumBeforeFrom : 0;
    const totals = await this.transactionsRepo.sumByAccountRange(
      accountId,
      from,
      to
    );
    const closingBalance = openingBalance + totals.totalNet;
    const safeOffset = offset ?? 0;
    const safeLimit = limit ?? totalCount;
    const hasMore = safeOffset + periodTransactions.length < totalCount;

    return {
      openingBalance,
      closingBalance,
      totalIn: totals.totalIn,
      totalOut: totals.totalOut,
      transactions: periodTransactions,
      totalCount,
      limit: safeLimit,
      offset: safeOffset,
      hasMore
    };
  }

  private previousDay(dateString: string): string {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  private validateCents(value: number, label: string) {
    if (!Number.isSafeInteger(value) || value > AccountsService.MAX_CENTS) {
      throw new InvalidAmountError(`${label} exceeds allowed limits`);
    }
  }
}
