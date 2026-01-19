import {
  Account,
  AccountsRepository,
  CreateAccountInput
} from "../../modules/accounts/repository";
import { NotFoundError, PersonNotFoundError } from "../../common/errors";
import { getPool } from "./pool";

export class PostgresAccountsRepository implements AccountsRepository {
  async create(input: CreateAccountInput): Promise<Account> {
    const pool = getPool();
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
          input.createDate
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
}
