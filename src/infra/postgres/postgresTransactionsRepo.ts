import {
  CreateTransactionInput,
  Transaction,
  TransactionsRepository
} from "../../modules/transactions/transactions.repository";
import { getPool } from "./pool";

export class PostgresTransactionsRepository implements TransactionsRepository {
  async create(input: CreateTransactionInput): Promise<Transaction> {
    const pool = getPool();
    const result = await pool.query(
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
      RETURNING
        transaction_id AS "transactionId",
        account_id AS "accountId",
        value_cents AS "valueCents",
        transaction_date AS "transactionDate";
      `,
      [input.accountId, input.valueCents, input.transactionDate]
    );

    return result.rows[0] as Transaction;
  }

  async listByAccount(
    accountId: string,
    from?: string,
    to?: string,
    limit?: number,
    offset?: number
  ): Promise<Transaction[]> {
    const pool = getPool();
    const params: Array<string | number> = [accountId];
    const conditions: string[] = ["account_id = $1"];

    if (from) {
      params.push(from);
      conditions.push(`transaction_date::date >= $${params.length}`);
    }

    if (to) {
      params.push(to);
      conditions.push(`transaction_date::date <= $${params.length}`);
    }

    let limitOffset = "";
    if (limit !== undefined) {
      params.push(limit);
      limitOffset += ` LIMIT $${params.length}`;
    }
    if (offset !== undefined) {
      params.push(offset);
      limitOffset += ` OFFSET $${params.length}`;
    }

    const result = await pool.query(
      `
      SELECT
        transaction_id AS "transactionId",
        account_id AS "accountId",
        value_cents AS "valueCents",
        transaction_date AS "transactionDate"
      FROM transactions
      WHERE ${conditions.join(" AND ")}
      ORDER BY transaction_date ASC${limitOffset};
      `,
      params
    );

    return result.rows as Transaction[];
  }

  async countByAccount(
    accountId: string,
    from?: string,
    to?: string
  ): Promise<number> {
    const pool = getPool();
    const params: Array<string | number> = [accountId];
    const conditions: string[] = ["account_id = $1"];

    if (from) {
      params.push(from);
      conditions.push(`transaction_date::date >= $${params.length}`);
    }

    if (to) {
      params.push(to);
      conditions.push(`transaction_date::date <= $${params.length}`);
    }

    const result = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM transactions
      WHERE ${conditions.join(" AND ")};
      `,
      params
    );

    return Number(result.rows[0]?.total ?? 0);
  }

  async sumByAccountRange(
    accountId: string,
    from?: string,
    to?: string
  ): Promise<{ totalIn: number; totalOut: number; totalNet: number }> {
    const pool = getPool();
    const params: Array<string | number> = [accountId];
    const conditions: string[] = ["account_id = $1"];

    if (from) {
      params.push(from);
      conditions.push(`transaction_date::date >= $${params.length}`);
    }

    if (to) {
      params.push(to);
      conditions.push(`transaction_date::date <= $${params.length}`);
    }

    const result = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN value_cents > 0 THEN value_cents ELSE 0 END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN value_cents < 0 THEN ABS(value_cents) ELSE 0 END), 0) AS total_out,
        COALESCE(SUM(value_cents), 0) AS total_net
      FROM transactions
      WHERE ${conditions.join(" AND ")};
      `,
      params
    );

    return {
      totalIn: Number(result.rows[0]?.total_in ?? 0),
      totalOut: Number(result.rows[0]?.total_out ?? 0),
      totalNet: Number(result.rows[0]?.total_net ?? 0)
    };
  }

  async sumWithdrawalsForDay(accountId: string, day: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `
      SELECT COALESCE(SUM(ABS(value_cents)), 0) AS total
      FROM transactions
      WHERE account_id = $1
        AND value_cents < 0
        AND transaction_date::date = $2::date;
      `,
      [accountId, day]
    );

    return Number(result.rows[0]?.total ?? 0);
  }
}
