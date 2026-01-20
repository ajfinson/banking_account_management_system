import {
  Account,
  AccountsRepository,
  CreateAccountInput
} from "../../modules/accounts/repository";
import { 
  NotFoundError, 
  PersonNotFoundError, 
  AccountBlockedError,
  InsufficientFundsError,
  DailyLimitExceededError,
  InvalidAmountError
} from "../../common/errors";
import { getPool } from "./pool";
import { config } from "../../config";

type LoggerLike = {
  warn?: (message: string, context?: unknown) => void;
  error?: (message: string, context?: unknown) => void;
};

export class PostgresAccountsRepository implements AccountsRepository {
  private readonly MAX_RETRIES = config.RETRY_MAX_ATTEMPTS;
  private readonly RETRY_BASE_DELAY_MS = config.RETRY_BASE_DELAY_MS;
  private readonly logger?: LoggerLike;

  constructor(logger?: LoggerLike) {
    this.logger = logger;
  }

  private isRetryableError(error: unknown): boolean {
    // Postgres error codes for serialization/deadlock
    const code = (error as { code?: string })?.code;
    return code === "40001" || // serialization_failure
           code === "40P01" || // deadlock_detected
           code === "55P03";   // lock_not_available
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    attemptNum: number = 0,
    context?: string
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // attemptNum starts at 0, so retry while attemptNum < MAX_RETRIES - 1
      // This ensures total attempts = 1 + MAX_RETRIES (initial + retries)
      if (attemptNum < this.MAX_RETRIES && this.isRetryableError(error)) {
        this.logger?.warn?.(`Retrying ${context || 'operation'} (retry ${attemptNum + 1}/${this.MAX_RETRIES})`, { error: error instanceof Error ? error.message : String(error) });
        // Exponential backoff with jitter: base * 2^attempt + random(0-base)
        const exponentialDelay = this.RETRY_BASE_DELAY_MS * Math.pow(2, attemptNum);
        const jitter = Math.random() * this.RETRY_BASE_DELAY_MS;
        await this.delay(exponentialDelay + jitter);
        return this.withRetry(operation, attemptNum + 1, context);
      }
      throw error;
    }
  }
  async create(input: CreateAccountInput): Promise<Account> {
    const pool = getPool();
    const createDate = input.createDate || new Date().toISOString();
    try {
      const result = await pool.query(
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
          input.personId,
          input.balanceCents,
          input.dailyWithdrawalLimitCents,
          input.activeFlag,
          input.accountType,
          createDate
        ]
      );

      return result.rows[0] as Account;
    } catch (error) {
      const pgError = error as { code?: string };
      if (pgError.code === "23503") {
        throw new PersonNotFoundError();
      }
      throw error;
    }
  }

  async getById(accountId: string): Promise<Account | null> {
    const pool = getPool();
    const result = await pool.query(
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
      WHERE account_id = $1;
      `,
      [accountId]
    );

    return (result.rows[0] as Account | undefined) ?? null;
  }

  async setActiveFlag(accountId: string, activeFlag: boolean): Promise<Account> {
    const pool = getPool();
    const result = await pool.query(
      `
      UPDATE account
      SET active_flag = $2
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
      [accountId, activeFlag]
    );

    if (!result.rows[0]) {
      throw new NotFoundError();
    }

    return result.rows[0] as Account;
  }

  async updateBalance(accountId: string, balanceCents: number): Promise<Account> {
    const pool = getPool();
    const result = await pool.query(
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
      [accountId, balanceCents]
    );

    if (!result.rows[0]) {
      throw new NotFoundError();
    }

    return result.rows[0] as Account;
  }

  async atomicDeposit(
    accountId: string,
    amountCents: number,
    transactionDate: string,
    idempotencyKey?: string
  ): Promise<{ balanceCents: number; transactionId: string }> {
    return this.withRetry(async () => {
      const pool = getPool();
      let client = null;
      
      try {
        client = await pool.connect();
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        
        // Check for existing transaction with this idempotency key FIRST
        if (idempotencyKey) {
          const existingTx = await client.query(
            `
            SELECT transaction_id AS "transactionId", account_id AS "accountId", balance_after AS "balanceAfter"
            FROM transactions
            WHERE idempotency_key = $1
            LIMIT 1;
            `,
            [idempotencyKey]
          );
          
          if (existingTx.rows[0]) {
            if (existingTx.rows[0].accountId === accountId) {
              // Transaction already exists for same account - return original result
              await client.query("COMMIT");
              return {
                balanceCents: Number(existingTx.rows[0].balanceAfter),
                transactionId: existingTx.rows[0].transactionId
              };
            } else {
              // Different account with same key - reject
              await client.query("ROLLBACK");
              throw new InvalidAmountError(
                `Idempotency key already used for different account`
              );
            }
          }
        }
        
        // Lock account row and check if active
        const accountResult = await client.query(
          `
          SELECT 
            account_id AS "accountId",
            balance_cents AS "balanceCents",
            active_flag AS "activeFlag"
          FROM account
          WHERE account_id = $1
          FOR UPDATE;
          `,
          [accountId]
        );
        
        if (!accountResult.rows[0]) {
          throw new NotFoundError();
        }
        
        const account = accountResult.rows[0];
        if (!account.activeFlag) {
          throw new AccountBlockedError();
        }
        
        const newBalance = Number(account.balanceCents) + amountCents;
        
        // Check for overflow
        if (newBalance > Number.MAX_SAFE_INTEGER) {
          throw new InvalidAmountError("Balance overflow: result exceeds safe integer limit");
        }
        
        // Ensure balance remains non-negative
        if (newBalance < 0) {
          throw new InvalidAmountError("Balance cannot be negative");
        }
        
        // Create transaction record
        const txResult = await client.query(
          `
          INSERT INTO transactions (
            account_id,
            value_cents,
            transaction_date,
            balance_after,
            idempotency_key
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING transaction_id AS "transactionId";
          `,
          [accountId, amountCents, transactionDate, newBalance, idempotencyKey ?? null]
        );
        
        // Update balance using calculated value we already checked
        await client.query(
          `
          UPDATE account
          SET balance_cents = $2
          WHERE account_id = $1;
          `,
          [accountId, newBalance]
        );
        
        await client.query("COMMIT");
        
        return {
          balanceCents: newBalance,
          transactionId: txResult.rows[0].transactionId as string
        };
      } catch (error) {
        if (client) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            // Connection may be bad - log but let finally handle release
            this.logger?.error?.('Failed to rollback transaction during deposit', {
              accountId,
              amountCents,
              originalError: error instanceof Error ? error.message : String(error),
              rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            });
          }
        }
        throw error;
      } finally {
        if (client) client.release();
      }
    });
  }

  async atomicWithdraw(
    accountId: string,
    amountCents: number,
    dailyWithdrawalLimit: number,
    transactionDate: string,
    today: string,
    idempotencyKey?: string
  ): Promise<{ balanceCents: number; transactionId: string }> {
    return this.withRetry(async () => {
      const pool = getPool();
      let client;
      
      try {
        client = await pool.connect();
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        
        // Check for existing transaction with this idempotency key FIRST
        if (idempotencyKey) {
          const existingTx = await client.query(
            `
            SELECT transaction_id AS "transactionId", account_id AS "accountId", balance_after AS "balanceAfter"
            FROM transactions
            WHERE idempotency_key = $1
            LIMIT 1;
            `,
            [idempotencyKey]
          );
          
          if (existingTx.rows[0]) {
            if (existingTx.rows[0].accountId === accountId) {
              // Same account, same key - return existing result
              await client.query("COMMIT");
              return {
                balanceCents: Number(existingTx.rows[0].balanceAfter),
                transactionId: existingTx.rows[0].transactionId
              };
            } else {
              // Different account with same key - reject
              await client.query("ROLLBACK");
              throw new InvalidAmountError(
                `Idempotency key already used for different account`
              );
            }
          }
        }
        
        // Lock account row and get current state
        const accountResult = await client.query(
          `
          SELECT 
            account_id AS "accountId",
            balance_cents AS "balanceCents",
            active_flag AS "activeFlag",
            daily_withdrawal_limit_cents AS "dailyWithdrawalLimitCents"
          FROM account
          WHERE account_id = $1
          FOR UPDATE;
          `,
          [accountId]
        );
        
        if (!accountResult.rows[0]) {
          throw new NotFoundError();
        }
        
        const account = accountResult.rows[0];
        if (!account.activeFlag) {
          throw new AccountBlockedError();
        }
        
        const currentBalance = Number(account.balanceCents);
        if (currentBalance < amountCents) {
          // Don't expose exact deficit for security reasons
          throw new InsufficientFundsError();
        }
        
        // Check daily withdrawal limit
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
        
        const dailyWithdrawals = Number(withdrawalsResult.rows[0]?.total ?? 0);
        if (dailyWithdrawals + amountCents > Number(account.dailyWithdrawalLimitCents)) {
          throw new DailyLimitExceededError();
        }
        
        // Calculate new balance first
        const newBalance = currentBalance - amountCents;
        
        // Ensure balance remains non-negative (redundant with insufficient funds check, but defensive)
        if (newBalance < 0) {
          throw new InsufficientFundsError("Balance cannot be negative");
        }
        
        // Create transaction record (negative value for withdrawal)
        const txResult = await client.query(
          `
          INSERT INTO transactions (
            account_id,
            value_cents,
            transaction_date,
            balance_after,
            idempotency_key
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING transaction_id AS "transactionId";
          `,
          [accountId, -amountCents, transactionDate, newBalance, idempotencyKey ?? null]
        );
        
        await client.query(
          `
          UPDATE account
          SET balance_cents = $2
          WHERE account_id = $1;
          `,
          [accountId, newBalance]
        );
        
        await client.query("COMMIT");
        
        return {
          balanceCents: newBalance,
          transactionId: txResult.rows[0].transactionId as string
        };
      } catch (error) {
        if (client) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            // Connection may be bad - log but let finally handle release
            this.logger?.error?.('Failed to rollback transaction during withdrawal', {
              accountId,
              amountCents,
              originalError: error instanceof Error ? error.message : String(error),
              rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            });
          }
        }
        throw error;
      } finally {
        if (client) client.release();
      }
    });
  }

  async createWithInitialBalance(
    input: CreateAccountInput,
    initialBalanceCents: number,
    transactionDate: string
  ): Promise<Account> {
    return this.withRetry(async () => {
      const pool = getPool();
      let client;
      const createDate = input.createDate || new Date().toISOString();
      
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        
        // Create account
        const accountResult = await client.query(
          `
          INSERT INTO account (
            person_id,
            balance_cents,
            daily_withdrawal_limit_cents,
            active_flag,
            account_type,
            create_date
          )
          VALUES ($1, $2, $3, $4, $5, $6)
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
            input.personId,
            input.balanceCents,
            input.dailyWithdrawalLimitCents,
            input.activeFlag,
            input.accountType,
            createDate
          ]
        );
        
        const account = accountResult.rows[0] as Account;
        
        // Create initial balance transaction
        if (initialBalanceCents > 0) {
          await client.query(
            `
            INSERT INTO transactions (
              account_id,
              value_cents,
              transaction_date,
              balance_after
            )
            VALUES ($1, $2, $3, $4);
            `,
            [account.accountId, initialBalanceCents, transactionDate, initialBalanceCents]
          );
        }
        
        await client.query("COMMIT");
        return account;
      } catch (error) {
        if (client) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            // Connection may be bad - log but let finally handle release
            this.logger?.error?.('Failed to rollback transaction during account creation', {
              personId: input.personId,
              initialBalanceCents,
              originalError: error instanceof Error ? error.message : String(error),
              rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            });
          }
        }
        const pgError = error as { code?: string };
        if (pgError.code === "23503") {
          throw new PersonNotFoundError();
        }
        throw error;
      } finally {
        if (client) client.release();
      }
    });
  }
}
