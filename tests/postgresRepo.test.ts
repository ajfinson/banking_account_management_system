import { randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";

type PoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  end: () => Promise<void>;
};

const databaseUrl = process.env.DATABASE_URL;
const shouldRun = Boolean(databaseUrl);

const describeMaybe = shouldRun ? describe : describe.skip;

describeMaybe("postgres integration", () => {
  let app: FastifyInstance;
  let pool: PoolLike;
  const personId = `test-person-${randomUUID()}`;
  let accountId = "";

  beforeAll(async () => {
    process.env.REPO_PROVIDER = "postgres";
    process.env.DATABASE_URL = databaseUrl;

    const [{ buildApp }, { getPool }] = await Promise.all([
      import("../src/app"),
      import("../src/infra/postgres/pool")
    ]);

    pool = getPool();
    await pool.query(
      "INSERT INTO person (person_id, full_name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [personId, "Test Person"]
    );

    app = buildApp();
    await app.ready();
  }, 20000);

  afterAll(async () => {
    if (accountId) {
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [accountId]);
    }
    await pool.query("DELETE FROM person WHERE person_id = $1", [personId]);
    await app.close();
    await pool.end();
  }, 20000);

  test("create, deposit, withdraw, statement", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        personId,
        dailyWithdrawalLimitCents: 5000,
        accountType: "checking",
        initialBalanceCents: 10000
      }
    });

    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    accountId = created.accountId;

    const depositRes = await app.inject({
      method: "POST",
      url: `/accounts/${accountId}/deposit`,
      payload: { amountCents: 1000 }
    });
    expect(depositRes.statusCode).toBe(200);

    const withdrawRes = await app.inject({
      method: "POST",
      url: `/accounts/${accountId}/withdraw`,
      payload: { amountCents: 600 }
    });
    expect(withdrawRes.statusCode).toBe(200);

    const today = new Date().toISOString().slice(0, 10);
    const statementRes = await app.inject({
      method: "GET",
      url: `/accounts/${accountId}/statement?from=${today}&to=${today}&limit=1&offset=0`
    });

    expect(statementRes.statusCode).toBe(200);
    const statement = statementRes.json();
    expect(statement.openingBalance).toBe(0);
    expect(statement.totalIn).toBe(11000);
    expect(statement.totalOut).toBe(600);
    expect(statement.closingBalance).toBe(10400);
    expect(statement.transactions).toHaveLength(1);
    expect(statement.totalCount).toBeGreaterThanOrEqual(3);
    expect(statement.limit).toBe(1);
    expect(statement.offset).toBe(0);
  });

  test("invalid personId returns not found", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        personId: "missing-person",
        dailyWithdrawalLimitCents: 5000,
        accountType: "checking",
        initialBalanceCents: 10000
      }
    });

    expect(createRes.statusCode).toBe(404);
    expect(createRes.json().error).toBe("PERSON_NOT_FOUND");
  });
});
