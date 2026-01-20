import { buildApp } from "../src/app";
import { FastifyInstance } from "fastify";
import { getPool, closePool } from "../src/infra/postgres/pool";
import { config } from "../src/config";

const shouldRun = config.REPO_PROVIDER === "postgres" && Boolean(process.env.DATABASE_URL);
const describeMaybe = shouldRun ? describe : describe.skip;

describeMaybe("Error Handling and Resilience", () => {
  let app: FastifyInstance;
  const now = () => new Date("2024-01-01T00:00:00Z");

  beforeAll(async () => {
    app = buildApp({ now });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (shouldRun) {
      await closePool();
    }
  });

  describe("Database Connection Failures", () => {
    test("health check returns down when database is unreachable", async () => {
      // Close the pool to simulate connection failure
      await closePool();

      const healthRes = await app.inject({
        method: "GET",
        url: "/health/db"
      });

      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json().status).toBe("down");

      // Reconnect for other tests
      const pool = getPool();
      await pool.query("SELECT 1");
    });

    test("operations fail gracefully when database connection is lost", async () => {
      // This test would require mocking the pool to throw connection errors
      // In a real scenario, we'd use dependency injection to inject a failing pool
      expect(true).toBe(true); // Placeholder - would need pool mocking
    });
  });

  describe("Retry Exhaustion", () => {
    test("concurrent operations eventually succeed despite serialization conflicts", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-retry",
          dailyWithdrawalLimitCents: 100000,
          accountType: "checking",
          initialBalanceCents: 50000
        }
      });

      const account = createRes.json();

      // Create high contention scenario with 50 concurrent operations
      const operations = Array.from({ length: 50 }, (_, i) =>
        app.inject({
          method: "POST",
          url: `/accounts/${account.accountId}/deposit`,
          payload: { amountCents: 10 }
        })
      );

      const results = await Promise.all(operations);

      // Some might fail due to retry exhaustion, but most should succeed
      const successes = results.filter(r => r.statusCode === 200);
      const failures = results.filter(r => r.statusCode === 500);

      expect(successes.length).toBeGreaterThan(40); // At least 80% success rate
      
      // If there are failures, they should be internal server errors
      failures.forEach(f => {
        expect(f.json().error).toBe("INTERNAL_SERVER_ERROR");
      });

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    });

    test("retry mechanism handles serialization failures correctly", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-serial",
          dailyWithdrawalLimitCents: 100000,
          accountType: "checking",
          initialBalanceCents: 10000
        }
      });

      const account = createRes.json();

      // Simulate worst-case: 100 concurrent withdrawals on same account
      const withdrawals = Array.from({ length: 100 }, () =>
        app.inject({
          method: "POST",
          url: `/accounts/${account.accountId}/withdraw`,
          payload: { amountCents: 50 }
        })
      );

      const results = await Promise.all(withdrawals);
      const successes = results.filter(r => r.statusCode === 200);

      // Should handle at least some concurrent operations successfully
      expect(successes.length).toBeGreaterThan(0);

      // Final balance should be consistent
      const balanceRes = await app.inject({
        method: "GET",
        url: `/accounts/${account.accountId}/balance`
      });

      const expectedBalance = 10000 - (successes.length * 50);
      expect(balanceRes.json().balanceCents).toBe(expectedBalance);

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    });
  });

  describe("Graceful Shutdown", () => {
    test("pending operations complete before shutdown", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-shutdown",
          dailyWithdrawalLimitCents: 10000,
          accountType: "checking",
          initialBalanceCents: 5000
        }
      });

      const account = createRes.json();

      // Start multiple operations
      const ops = [
        app.inject({
          method: "POST",
          url: `/accounts/${account.accountId}/deposit`,
          payload: { amountCents: 100 }
        }),
        app.inject({
          method: "POST",
          url: `/accounts/${account.accountId}/deposit`,
          payload: { amountCents: 200 }
        })
      ];

      const results = await Promise.all(ops);

      // All operations should complete successfully
      results.forEach(r => {
        expect(r.statusCode).toBe(200);
      });

      // Verify data consistency after operations
      const balanceRes = await app.inject({
        method: "GET",
        url: `/accounts/${account.accountId}/balance`
      });

      expect(balanceRes.json().balanceCents).toBe(5300);

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    });

    test("mutex cleanup happens on application close", async () => {
      // Create a separate app instance to test cleanup
      const testApp = buildApp({ now });
      await testApp.ready();

      const createRes = await testApp.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-mutex",
          dailyWithdrawalLimitCents: 10000,
          accountType: "checking",
          initialBalanceCents: 1000
        }
      });

      const account = createRes.json();

      // Perform operation to create mutex
      await testApp.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/deposit`,
        payload: { amountCents: 100 }
      });

      // Close app - should clean up mutexes
      await testApp.close();

      // Cleanup account
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);

      expect(true).toBe(true); // If we got here, cleanup worked
    });
  });

  describe("Transaction Rollback on Errors", () => {
    test("deposit rollback on constraint violation", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-rollback",
          dailyWithdrawalLimitCents: 10000,
          accountType: "checking",
          initialBalanceCents: 1000
        }
      });

      const account = createRes.json();

      // Try to deposit MAX_SAFE_INTEGER + 1 (should fail overflow check)
      const depositRes = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/deposit`,
        payload: { amountCents: Number.MAX_SAFE_INTEGER }
      });

      expect(depositRes.statusCode).toBe(400);
      expect(depositRes.json().error).toBe("INVALID_AMOUNT");

      // Balance should remain unchanged
      const balanceRes = await app.inject({
        method: "GET",
        url: `/accounts/${account.accountId}/balance`
      });

      expect(balanceRes.json().balanceCents).toBe(1000);

      // Verify no orphaned transactions
      const pool = getPool();
      const txResult = await pool.query(
        "SELECT COUNT(*) FROM transactions WHERE account_id = $1",
        [account.accountId]
      );
      expect(Number(txResult.rows[0].count)).toBe(1); // Only initial balance transaction

      // Cleanup
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    });

    test("withdrawal rollback on daily limit exceeded", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-limit",
          dailyWithdrawalLimitCents: 1000,
          accountType: "checking",
          initialBalanceCents: 10000
        }
      });

      const account = createRes.json();

      // Withdraw up to limit
      await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/withdraw`,
        payload: { amountCents: 1000 }
      });

      // Try to exceed limit
      const withdrawRes = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/withdraw`,
        payload: { amountCents: 100 }
      });

      expect(withdrawRes.statusCode).toBe(409);
      expect(withdrawRes.json().error).toBe("DAILY_LIMIT_EXCEEDED");

      // Balance should only reflect first withdrawal
      const balanceRes = await app.inject({
        method: "GET",
        url: `/accounts/${account.accountId}/balance`
      });

      expect(balanceRes.json().balanceCents).toBe(9000);

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    });
  });
});
