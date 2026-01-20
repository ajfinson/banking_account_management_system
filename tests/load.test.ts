import { buildApp } from "../src/app";
import { FastifyInstance } from "fastify";
import { getPool, closePool } from "../src/infra/postgres/pool";
import { config } from "../src/config";

const shouldRun = config.REPO_PROVIDER === "postgres" && Boolean(process.env.DATABASE_URL);
const describeMaybe = shouldRun ? describe : describe.skip;

describeMaybe("Load and Stress Testing", () => {
  let app: FastifyInstance;
  const now = () => new Date("2024-01-01T00:00:00Z");

  beforeAll(async () => {
    app = buildApp({ now });
    await app.ready();
  }, 30000);

  afterAll(async () => {
    await app.close();
    if (shouldRun) {
      await closePool();
    }
  }, 30000);

  describe("High Concurrency Operations", () => {
    test("handles 500 concurrent account creations", async () => {
      const operations = Array.from({ length: 500 }, (_, i) =>
        app.inject({
          method: "POST",
          url: "/accounts",
          payload: {
            personId: "test-person-load",
            dailyWithdrawalLimitCents: 10000,
            accountType: "checking",
            initialBalanceCents: 1000
          }
        })
      );

      const startTime = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - startTime;

      const successes = results.filter(r => r.statusCode === 201);
      expect(successes.length).toBeGreaterThan(450); // At least 90% success

      // Cleanup
      const pool = getPool();
      const accountIds = successes.map(r => r.json().accountId);
      for (const id of accountIds) {
        await pool.query("DELETE FROM transactions WHERE account_id = $1", [id]);
        await pool.query("DELETE FROM account WHERE account_id = $1", [id]);
      }
    }, 60000);

    test("handles 1000 concurrent deposits on different accounts", async () => {
      // Create 100 accounts first
      const accountPromises = Array.from({ length: 100 }, () =>
        app.inject({
          method: "POST",
          url: "/accounts",
          payload: {
            personId: "test-person-deposits",
            dailyWithdrawalLimitCents: 100000,
            accountType: "checking",
            initialBalanceCents: 5000
          }
        })
      );

      const accountResults = await Promise.all(accountPromises);
      const accounts = accountResults.map(r => r.json());

      // Perform 1000 deposits (10 per account)
      const depositPromises = accounts.flatMap(account =>
        Array.from({ length: 10 }, () =>
          app.inject({
            method: "POST",
            url: `/accounts/${account.accountId}/deposit`,
            payload: { amountCents: 100 }
          })
        )
      );

      const startTime = Date.now();
      const results = await Promise.all(depositPromises);
      const duration = Date.now() - startTime;

      const successes = results.filter(r => r.statusCode === 200);
      expect(successes.length).toBeGreaterThan(900); // At least 90% success

      // Verify balances are consistent
      const balancePromises = accounts.map(account =>
        app.inject({
          method: "GET",
          url: `/accounts/${account.accountId}/balance`
        })
      );

      const balanceResults = await Promise.all(balancePromises);
      balanceResults.forEach(result => {
        const balance = result.json().balanceCents;
        expect(balance).toBeGreaterThanOrEqual(5000);
        expect(balance).toBeLessThanOrEqual(6000); // 5000 + (10 * 100)
      });

      // Cleanup
      const pool = getPool();
      for (const account of accounts) {
        await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
        await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
      }
    }, 90000);

    test("handles 500 concurrent withdrawals with contention", async () => {
      // Create account with sufficient balance and limit
      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-withdraw-load",
          dailyWithdrawalLimitCents: 100000,
          accountType: "checking",
          initialBalanceCents: 50000
        }
      });

      const account = createRes.json();

      // Attempt 500 concurrent $50 withdrawals
      const operations = Array.from({ length: 500 }, () =>
        app.inject({
          method: "POST",
          url: `/accounts/${account.accountId}/withdraw`,
          payload: { amountCents: 50 }
        })
      );

      const startTime = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - startTime;

      const successes = results.filter(r => r.statusCode === 200);
      const insufficientFunds = results.filter(
        r => r.statusCode === 409 && r.json().error === "INSUFFICIENT_FUNDS"
      );
      const dailyLimit = results.filter(
        r => r.statusCode === 409 && r.json().error === "DAILY_LIMIT_EXCEEDED"
      );

      // Should withdraw until one of the limits is hit
      expect(successes.length).toBeGreaterThan(0);
      expect(successes.length).toBeLessThanOrEqual(1000); // Balance limit: 50000/50
      expect(insufficientFunds.length + dailyLimit.length).toBeGreaterThan(0);

      // Final balance should be consistent
      const balanceRes = await app.inject({
        method: "GET",
        url: `/accounts/${account.accountId}/balance`
      });

      const expectedBalance = 50000 - (successes.length * 50);
      expect(balanceRes.json().balanceCents).toBe(expectedBalance);
      expect(balanceRes.json().balanceCents).toBeGreaterThanOrEqual(0);

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    }, 90000);
  });

  describe("Statement Query Performance", () => {
    test("handles statement queries with thousands of transactions", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-statement",
          dailyWithdrawalLimitCents: 1000000,
          accountType: "checking",
          initialBalanceCents: 100000
        }
      });

      const account = createRes.json();

      // Create 1000 transactions
      const txPromises = Array.from({ length: 1000 }, (_, i) =>
        app.inject({
          method: "POST",
          url: `/accounts/${account.accountId}/deposit`,
          payload: { amountCents: 10 }
        })
      );

      await Promise.all(txPromises);

      // Query statement with pagination
      const startTime = Date.now();
      const statementRes = await app.inject({
        method: "GET",
        url: `/accounts/${account.accountId}/statement?from=2024-01-01&to=2024-01-01&limit=50&offset=0`
      });
      const duration = Date.now() - startTime;

      expect(statementRes.statusCode).toBe(200);
      const statement = statementRes.json();
      expect(statement.transactions).toHaveLength(50);
      expect(statement.totalCount).toBeGreaterThan(1000);

      // Test multiple concurrent statement queries
      const queryPromises = Array.from({ length: 50 }, (_, i) =>
        app.inject({
          method: "GET",
          url: `/accounts/${account.accountId}/statement?from=2024-01-01&to=2024-01-01&limit=20&offset=${i * 20}`
        })
      );

      const queryStart = Date.now();
      const queryResults = await Promise.all(queryPromises);
      const queryDuration = Date.now() - queryStart;

      const successfulQueries = queryResults.filter(r => r.statusCode === 200);
      expect(successfulQueries.length).toBe(50);

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    }, 120000);

    test("handles pagination with large offsets efficiently", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-pagination",
          dailyWithdrawalLimitCents: 1000000,
          accountType: "checking",
          initialBalanceCents: 10000
        }
      });

      const account = createRes.json();

      // Create 500 transactions
      const txPromises = Array.from({ length: 500 }, () =>
        app.inject({
          method: "POST",
          url: `/accounts/${account.accountId}/deposit`,
          payload: { amountCents: 10 }
        })
      );

      await Promise.all(txPromises);

      // Test pagination at different offsets
      const offsets = [0, 100, 200, 300, 400];
      const timings: number[] = [];

      for (const offset of offsets) {
        const start = Date.now();
        const res = await app.inject({
          method: "GET",
          url: `/accounts/${account.accountId}/statement?from=2024-01-01&to=2024-01-01&limit=50&offset=${offset}`
        });
        const duration = Date.now() - start;
        timings.push(duration);

        expect(res.statusCode).toBe(200);
        expect(res.json().transactions.length).toBeGreaterThan(0);
      }

      // Verify performance doesn't degrade significantly with offset
      const maxTiming = Math.max(...timings);
      const minTiming = Math.min(...timings);
      expect(maxTiming / minTiming).toBeLessThan(5); // Max 5x slower at high offsets

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    }, 120000);
  });

  describe("Pool Exhaustion Protection", () => {
    test("system remains responsive under pool pressure", async () => {
      // Create 50 accounts
      const accountPromises = Array.from({ length: 50 }, () =>
        app.inject({
          method: "POST",
          url: "/accounts",
          payload: {
            personId: "test-person-pool",
            dailyWithdrawalLimitCents: 50000,
            accountType: "checking",
            initialBalanceCents: 10000
          }
        })
      );

      const accountResults = await Promise.all(accountPromises);
      const accounts = accountResults.map(r => r.json());

      // Fire 500 operations simultaneously (10 per account)
      // This creates pressure on the connection pool
      const operations = accounts.flatMap(account =>
        Array.from({ length: 10 }, (_, i) => {
          const isDeposit = i % 2 === 0;
          return app.inject({
            method: "POST",
            url: `/accounts/${account.accountId}/${isDeposit ? 'deposit' : 'withdraw'}`,
            payload: { amountCents: 100 }
          });
        })
      );

      const startTime = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - startTime;

      const successes = results.filter(r => r.statusCode === 200);
      const errors = results.filter(r => r.statusCode === 500);


      // Should handle most operations even under pressure
      expect(successes.length).toBeGreaterThan(400); // At least 80%
      
      // Verify system is still responsive
      const healthRes = await app.inject({
        method: "GET",
        url: "/health/db"
      });

      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json().status).toBe("ok");

      // Cleanup
      const pool = getPool();
      for (const account of accounts) {
        await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
        await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
      }
    }, 120000);
  });
});
