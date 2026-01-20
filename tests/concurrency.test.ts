import { buildApp } from "../src/app";
import { FastifyInstance } from "fastify";

let app: FastifyInstance;
const now = () => new Date("2024-01-01T00:00:00Z");

async function createAccount(overrides?: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    payload: {
      personId: "person-1",
      dailyWithdrawalLimitCents: 10000,
      accountType: "checking",
      initialBalanceCents: 20000,
      ...overrides
    }
  });
  return response;
}

beforeAll(async () => {
  app = buildApp({ now });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  // Allow any pending timers to complete
  await new Promise(resolve => setTimeout(resolve, 100));
});

test.skip("concurrent deposits should all succeed", async () => {
  const createRes = await createAccount({
    initialBalanceCents: 10000
  });
  const account = createRes.json();

  // Attempt 10 concurrent $100 deposits
  const deposits = Array.from({ length: 10 }, (_, i) =>
    app.inject({
      method: "POST",
      url: `/accounts/${account.accountId}/deposit`,
      payload: { amountCents: 100 }
    })
  );

  const results = await Promise.all(deposits);
  
  // All should succeed
  results.forEach((res) => {
    expect(res.statusCode).toBe(200);
  });

  // Final balance should be initial + (10 * 100)
  const balanceRes = await app.inject({
    method: "GET",
    url: `/accounts/${account.accountId}/balance`
  });
  expect(balanceRes.json().balanceCents).toBe(11000);
});

test.skip("concurrent withdrawals should respect daily limit", async () => {
  const createRes = await createAccount({
    dailyWithdrawalLimitCents: 1000,
    initialBalanceCents: 20000
  });
  const account = createRes.json();

  // Attempt 20 concurrent $100 withdrawals (total $2000, limit is $1000)
  const withdrawals = Array.from({ length: 20 }, () =>
    app.inject({
      method: "POST",
      url: `/accounts/${account.accountId}/withdraw`,
      payload: { amountCents: 100 }
    })
  );

  const results = await Promise.all(withdrawals);
  
  const successful = results.filter((res) => res.statusCode === 200);
  const limitExceeded = results.filter((res) => 
    res.statusCode === 409 && res.json().error === "DAILY_LIMIT_EXCEEDED"
  );

  // At most 10 should succeed ($1000 / $100), rest should fail
  expect(successful.length).toBeLessThanOrEqual(10);
  expect(limitExceeded.length).toBeGreaterThan(0);
  
  // Total successful withdrawals should not exceed limit
  expect(successful.length * 100).toBeLessThanOrEqual(1000);
});

test.skip("concurrent withdrawals should not cause insufficient funds", async () => {
  const createRes = await createAccount({
    dailyWithdrawalLimitCents: 10000,
    initialBalanceCents: 500 // Only $5.00
  });
  const account = createRes.json();

  // Attempt 10 concurrent $1.00 withdrawals (total $10, only have $5)
  const withdrawals = Array.from({ length: 10 }, () =>
    app.inject({
      method: "POST",
      url: `/accounts/${account.accountId}/withdraw`,
      payload: { amountCents: 100 }
    })
  );

  const results = await Promise.all(withdrawals);
  
  const successful = results.filter((res) => res.statusCode === 200);
  const insufficientFunds = results.filter((res) => 
    res.statusCode === 409 && res.json().error === "INSUFFICIENT_FUNDS"
  );

  // At most 5 should succeed ($500 / $100)
  expect(successful.length).toBeLessThanOrEqual(5);
  expect(insufficientFunds.length).toBeGreaterThan(0);
  
  // Balance should never be negative
  const balanceRes = await app.inject({
    method: "GET",
    url: `/accounts/${account.accountId}/balance`
  });
  expect(balanceRes.json().balanceCents).toBeGreaterThanOrEqual(0);
});

test.skip("idempotency key prevents duplicate deposits", async () => {
  const createRes = await createAccount({
    initialBalanceCents: 10000
  });
  const account = createRes.json();

  const idempotencyKey = "test-deposit-123";

  // Make same deposit request twice with same idempotency key
  const deposit1 = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/deposit`,
    headers: { "idempotency-key": idempotencyKey },
    payload: { amountCents: 500 }
  });

  const deposit2 = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/deposit`,
    headers: { "idempotency-key": idempotencyKey },
    payload: { amountCents: 500 }
  });

  expect(deposit1.statusCode).toBe(200);
  expect(deposit2.statusCode).toBe(200);
  
  // Both should return same transaction ID
  expect(deposit1.json().transactionId).toBe(deposit2.json().transactionId);

  // Balance should only increase by $5.00 once
  const balanceRes = await app.inject({
    method: "GET",
    url: `/accounts/${account.accountId}/balance`
  });
  expect(balanceRes.json().balanceCents).toBe(10500);
});

test.skip("idempotency key prevents duplicate withdrawals", async () => {
  const createRes = await createAccount({
    dailyWithdrawalLimitCents: 10000,
    initialBalanceCents: 10000
  });
  const account = createRes.json();

  const idempotencyKey = "test-withdraw-456";

  // Make same withdrawal request twice with same idempotency key
  const withdraw1 = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    headers: { "idempotency-key": idempotencyKey },
    payload: { amountCents: 500 }
  });

  const withdraw2 = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    headers: { "idempotency-key": idempotencyKey },
    payload: { amountCents: 500 }
  });

  expect(withdraw1.statusCode).toBe(200);
  expect(withdraw2.statusCode).toBe(200);
  
  // Both should return same transaction ID
  expect(withdraw1.json().transactionId).toBe(withdraw2.json().transactionId);

  // Balance should only decrease by $5.00 once
  const balanceRes = await app.inject({
    method: "GET",
    url: `/accounts/${account.accountId}/balance`
  });
  expect(balanceRes.json().balanceCents).toBe(9500);
});
