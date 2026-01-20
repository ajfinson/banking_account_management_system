import { buildApp } from "../src/app";
import { FastifyInstance } from "fastify";
import { getPool, closePool } from "../src/infra/postgres/pool";
import { config } from "../src/config";

const shouldRun = config.REPO_PROVIDER === "postgres" && Boolean(process.env.DATABASE_URL);
const describeMaybe = shouldRun ? describe : describe.skip;

describeMaybe("Chaos Engineering and Edge Cases", () => {
  let app: FastifyInstance;

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (shouldRun) {
      await closePool();
    }
  }, 30000);

  describe("Clock Skew Scenarios", () => {
    test("handles transactions with time going backwards", async () => {
      let currentTime = new Date("2024-01-01T12:00:00Z");
      const now = () => currentTime;

      app = buildApp({ now });
      await app.ready();

      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-clock",
          dailyWithdrawalLimitCents: 10000,
          accountType: "checking",
          initialBalanceCents: 5000
        }
      });

      const account = createRes.json();

      // First withdrawal at noon
      const withdraw1 = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/withdraw`,
        payload: { amountCents: 1000 }
      });
      expect(withdraw1.statusCode).toBe(200);

      // Time goes backwards by 1 hour (clock skew)
      currentTime = new Date("2024-01-01T11:00:00Z");

      // Second withdrawal should still work
      const withdraw2 = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/withdraw`,
        payload: { amountCents: 1000 }
      });
      expect(withdraw2.statusCode).toBe(200);

      // Verify daily limit is still calculated correctly
      // Even with skewed timestamps, both withdrawals count toward same day
      const withdraw3 = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/withdraw`,
        payload: { amountCents: 8001 }
      });
      expect(withdraw3.statusCode).toBe(409);
      expect(withdraw3.json().error).toBe("DAILY_LIMIT_EXCEEDED");

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    }, 30000);

    test("handles daily limit reset across midnight UTC", async () => {
      let currentTime = new Date("2024-01-01T23:59:50Z");
      const now = () => currentTime;

      app = buildApp({ now });
      await app.ready();

      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-midnight",
          dailyWithdrawalLimitCents: 1000,
          accountType: "checking",
          initialBalanceCents: 10000
        }
      });

      const account = createRes.json();

      // Withdraw at 23:59:50
      const withdraw1 = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/withdraw`,
        payload: { amountCents: 1000 }
      });
      expect(withdraw1.statusCode).toBe(200);

      // Try another withdrawal - should fail (limit reached)
      const withdraw2 = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/withdraw`,
        payload: { amountCents: 100 }
      });
      expect(withdraw2.statusCode).toBe(409);
      expect(withdraw2.json().error).toBe("DAILY_LIMIT_EXCEEDED");

      // Jump to next day
      currentTime = new Date("2024-01-02T00:00:10Z");

      // Should be able to withdraw again (new day)
      const withdraw3 = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/withdraw`,
        payload: { amountCents: 1000 }
      });
      expect(withdraw3.statusCode).toBe(200);

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    }, 30000);

    test("handles future-dated transactions", async () => {
      const futureTime = new Date("2099-12-31T23:59:59Z");
      const now = () => futureTime;

      app = buildApp({ now });
      await app.ready();

      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-future",
          dailyWithdrawalLimitCents: 5000,
          accountType: "checking",
          initialBalanceCents: 10000
        }
      });

      const account = createRes.json();

      // Operations should work even with future dates
      const deposit = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/deposit`,
        payload: { amountCents: 1000 }
      });
      expect(deposit.statusCode).toBe(200);

      // Statement query should handle future dates
      const statement = await app.inject({
        method: "GET",
        url: `/accounts/${account.accountId}/statement?from=2099-12-31&to=2099-12-31`
      });
      expect(statement.statusCode).toBe(200);

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    }, 30000);
  });

  describe("Long-Running Transactions", () => {
    test("handles operations that take multiple seconds", async () => {
      const now = () => new Date("2024-01-01T12:00:00Z");
      app = buildApp({ now });
      await app.ready();

      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-slow",
          dailyWithdrawalLimitCents: 50000,
          accountType: "checking",
          initialBalanceCents: 10000
        }
      });

      const account = createRes.json();

      // Simulate slow operations by firing many concurrent requests
      // that will cause database contention
      const operations = Array.from({ length: 100 }, () =>
        app.inject({
          method: "POST",
          url: `/accounts/${account.accountId}/deposit`,
          payload: { amountCents: 10 }
        })
      );

      const startTime = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - startTime;

      // Even if some fail due to timeouts, system should remain consistent
      const successes = results.filter(r => r.statusCode === 200);
      expect(successes.length).toBeGreaterThan(0);

      // Verify final balance matches successful operations
      const balanceRes = await app.inject({
        method: "GET",
        url: `/accounts/${account.accountId}/balance`
      });

      const expectedBalance = 10000 + (successes.length * 10);
      expect(balanceRes.json().balanceCents).toBe(expectedBalance);

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    }, 60000);
  });

  describe("Data Consistency Under Stress", () => {
    test("maintains consistency with mixed operations and failures", async () => {
      const now = () => new Date("2024-01-01T12:00:00Z");
      app = buildApp({ now });
      await app.ready();

      // Create multiple accounts
      const accountPromises = Array.from({ length: 10 }, () =>
        app.inject({
          method: "POST",
          url: "/accounts",
          payload: {
            personId: "test-person-consistency",
            dailyWithdrawalLimitCents: 50000,
            accountType: "checking",
            initialBalanceCents: 10000
          }
        })
      );

      const accountResults = await Promise.all(accountPromises);
      const accounts = accountResults.map(r => r.json());

      // Mix of operations: valid, invalid, blocked accounts
      const operations: Promise<any>[] = [];

      // Block some accounts randomly
      const accountsToBlock = accounts.slice(0, 3);
      for (const account of accountsToBlock) {
        await app.inject({
          method: "POST",
          url: `/accounts/${account.accountId}/block`
        });
      }

      // Create mixed workload
      for (const account of accounts) {
        // Valid deposits
        operations.push(
          app.inject({
            method: "POST",
            url: `/accounts/${account.accountId}/deposit`,
            payload: { amountCents: 100 }
          })
        );

        // Valid withdrawals
        operations.push(
          app.inject({
            method: "POST",
            url: `/accounts/${account.accountId}/withdraw`,
            payload: { amountCents: 50 }
          })
        );

        // Invalid amounts (should fail)
        operations.push(
          app.inject({
            method: "POST",
            url: `/accounts/${account.accountId}/deposit`,
            payload: { amountCents: 0 }
          })
        );

        // Overdraft attempts (should fail)
        operations.push(
          app.inject({
            method: "POST",
            url: `/accounts/${account.accountId}/withdraw`,
            payload: { amountCents: 1000000 }
          })
        );
      }

      const results = await Promise.all(operations);

      // Verify all accounts have consistent balances
      const pool = getPool();
      for (const account of accounts) {
        const txResult = await pool.query(
          `
          SELECT 
            COALESCE(SUM(value_cents), 0) as total_value,
            COUNT(*) as tx_count
          FROM transactions 
          WHERE account_id = $1
          `,
          [account.accountId]
        );

        const accountResult = await pool.query(
          "SELECT balance_cents FROM account WHERE account_id = $1",
          [account.accountId]
        );

        const calculatedBalance = 10000 + Number(txResult.rows[0].total_value);
        const actualBalance = Number(accountResult.rows[0].balance_cents);

        // Balance should match sum of transactions
        expect(actualBalance).toBe(calculatedBalance);
        expect(actualBalance).toBeGreaterThanOrEqual(0);
      }

      // Cleanup
      for (const account of accounts) {
        await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
        await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
      }
    }, 60000);

    test("idempotency keys remain unique under high contention", async () => {
      const now = () => new Date("2024-01-01T12:00:00Z");
      app = buildApp({ now });
      await app.ready();

      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-idempotency",
          dailyWithdrawalLimitCents: 100000,
          accountType: "checking",
          initialBalanceCents: 50000
        }
      });

      const account = createRes.json();

      // Try to use same idempotency key 100 times concurrently
      const idempotencyKey = "chaos-test-key-123";
      const operations = Array.from({ length: 100 }, () =>
        app.inject({
          method: "POST",
          url: `/accounts/${account.accountId}/deposit`,
          headers: { "idempotency-key": idempotencyKey },
          payload: { amountCents: 100 }
        })
      );

      const results = await Promise.all(operations);

      // All should return 200 (either created or duplicate)
      const successes = results.filter(r => r.statusCode === 200);
      expect(successes.length).toBe(100);

      // But only ONE transaction should be created
      const pool = getPool();
      const txResult = await pool.query(
        "SELECT COUNT(*) FROM transactions WHERE idempotency_key = $1",
        [idempotencyKey]
      );

      expect(Number(txResult.rows[0].count)).toBe(1);

      // Final balance should reflect single deposit
      const balanceRes = await app.inject({
        method: "GET",
        url: `/accounts/${account.accountId}/balance`
      });

      expect(balanceRes.json().balanceCents).toBe(50100);

      // Cleanup
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    }, 60000);
  });

  describe("Extreme Value Testing", () => {
    test("handles accounts with millions in balance", async () => {
      const now = () => new Date("2024-01-01T12:00:00Z");
      app = buildApp({ now });
      await app.ready();

      const largeBalance = 900_000_000_000_000; // $9 trillion in cents
      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-large",
          dailyWithdrawalLimitCents: 100_000_000_000, // $1B daily limit
          accountType: "checking",
          initialBalanceCents: largeBalance
        }
      });

      expect(createRes.statusCode).toBe(201);
      const account = createRes.json();

      // Large deposit
      const depositRes = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/deposit`,
        payload: { amountCents: 1_000_000_000 } // $10M
      });

      expect(depositRes.statusCode).toBe(200);

      // Large withdrawal
      const withdrawRes = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/withdraw`,
        payload: { amountCents: 50_000_000_000 } // $500M
      });

      expect(withdrawRes.statusCode).toBe(200);

      // Verify precision is maintained
      const balanceRes = await app.inject({
        method: "GET",
        url: `/accounts/${account.accountId}/balance`
      });

      const expectedBalance = largeBalance + 1_000_000_000 - 50_000_000_000;
      expect(balanceRes.json().balanceCents).toBe(expectedBalance);

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    }, 30000);

    test("rejects operations that would cause overflow", async () => {
      const now = () => new Date("2024-01-01T12:00:00Z");
      app = buildApp({ now });
      await app.ready();

      const nearMaxBalance = Number.MAX_SAFE_INTEGER - 1000;
      const createRes = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          personId: "test-person-overflow",
          dailyWithdrawalLimitCents: 10000,
          accountType: "checking",
          initialBalanceCents: nearMaxBalance
        }
      });

      expect(createRes.statusCode).toBe(201);
      const account = createRes.json();

      // Try to deposit amount that would overflow
      const depositRes = await app.inject({
        method: "POST",
        url: `/accounts/${account.accountId}/deposit`,
        payload: { amountCents: 2000 }
      });

      expect(depositRes.statusCode).toBe(400);
      expect(depositRes.json().error).toBe("INVALID_AMOUNT");
      expect(depositRes.json().message).toContain("overflow");

      // Balance should remain unchanged
      const balanceRes = await app.inject({
        method: "GET",
        url: `/accounts/${account.accountId}/balance`
      });

      expect(balanceRes.json().balanceCents).toBe(nearMaxBalance);

      // Cleanup
      const pool = getPool();
      await pool.query("DELETE FROM transactions WHERE account_id = $1", [account.accountId]);
      await pool.query("DELETE FROM account WHERE account_id = $1", [account.accountId]);
    }, 30000);
  });
});
