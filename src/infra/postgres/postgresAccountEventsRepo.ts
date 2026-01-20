import { AccountEvent, AccountEventsRepository } from "../../modules/accounts/repository";
import { getPool } from "./pool";

export class PostgresAccountEventsRepository implements AccountEventsRepository {
  async create(event: Omit<AccountEvent, 'eventId'>): Promise<AccountEvent> {
    const pool = getPool();
    const result = await pool.query(
      `
      INSERT INTO account_events (
        account_id,
        event_type,
        event_date,
        request_id
      )
      VALUES ($1, $2, $3, $4)
      RETURNING
        event_id AS "eventId",
        account_id AS "accountId",
        event_type AS "eventType",
        event_date AS "eventDate",
        request_id AS "requestId";
      `,
      [event.accountId, event.eventType, event.eventDate, event.requestId ?? null]
    );

    return result.rows[0] as AccountEvent;
  }

  async listByAccount(accountId: string): Promise<AccountEvent[]> {
    const pool = getPool();
    const result = await pool.query(
      `
      SELECT
        event_id AS "eventId",
        account_id AS "accountId",
        event_type AS "eventType",
        event_date AS "eventDate",
        request_id AS "requestId"
      FROM account_events
      WHERE account_id = $1
      ORDER BY event_date DESC;
      `,
      [accountId]
    );

    return result.rows as AccountEvent[];
  }
}
