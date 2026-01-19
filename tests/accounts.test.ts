import { buildApp } from "../src/app";
import { FastifyInstance } from "fastify";

let app: FastifyInstance;
let nowValue = new Date("2024-01-01T00:00:00Z");
const now = () => nowValue;

async function createAccount(overrides?: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    payload: {
      personId: "person-1",
      dailyWithdrawalLimitCents: 1000,
      accountType: "checking",
      initialBalanceCents: 5000,
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
});

test("create account and deposit/withdraw", async () => {
  const createRes = await createAccount({
    dailyWithdrawalLimitCents: 2000,
    initialBalanceCents: 10000
  });
  expect(createRes.statusCode).toBe(201);
  const account = createRes.json();

  const depositRes = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/deposit`,
    payload: { amountCents: 500 }
  });
  expect(depositRes.statusCode).toBe(200);
  expect(depositRes.json().balanceCents).toBe(10500);

  const withdrawRes = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    payload: { amountCents: 300 }
  });
  expect(withdrawRes.statusCode).toBe(200);
  expect(withdrawRes.json().balanceCents).toBe(10200);
});

test("blocked account cannot deposit", async () => {
  const createRes = await createAccount();
  const account = createRes.json();

  const blockRes = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/block`
  });
  expect(blockRes.statusCode).toBe(200);

  const depositRes = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/deposit`,
    payload: { amountCents: 100 }
  });
  expect(depositRes.statusCode).toBe(409);
  expect(depositRes.json().error).toBe("ACCOUNT_BLOCKED");
});

test("block is not allowed when already blocked", async () => {
  const createRes = await createAccount();
  const account = createRes.json();

  await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/block`
  });

  const secondBlock = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/block`
  });

  expect(secondBlock.statusCode).toBe(409);
  expect(secondBlock.json().error).toBe("ALREADY_BLOCKED");
});

test("unblock allows deposits again", async () => {
  const createRes = await createAccount();
  const account = createRes.json();

  await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/block`
  });

  const unblockRes = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/unblock`
  });
  expect(unblockRes.statusCode).toBe(200);

  const depositRes = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/deposit`,
    payload: { amountCents: 100 }
  });
  expect(depositRes.statusCode).toBe(200);
});

test("unblock is not allowed when already unblocked", async () => {
  const createRes = await createAccount();
  const account = createRes.json();

  const unblockRes = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/unblock`
  });

  expect(unblockRes.statusCode).toBe(409);
  expect(unblockRes.json().error).toBe("ALREADY_UNBLOCKED");
});

test("blocked account cannot withdraw", async () => {
  const createRes = await createAccount();
  const account = createRes.json();

  await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/block`
  });

  const withdrawRes = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    payload: { amountCents: 100 }
  });

  expect(withdrawRes.statusCode).toBe(409);
  expect(withdrawRes.json().error).toBe("ACCOUNT_BLOCKED");
});

test("daily limit enforced", async () => {
  const createRes = await createAccount({
    dailyWithdrawalLimitCents: 1000,
    initialBalanceCents: 5000
  });
  const account = createRes.json();

  const firstWithdraw = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    payload: { amountCents: 700 }
  });
  expect(firstWithdraw.statusCode).toBe(200);

  const secondWithdraw = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    payload: { amountCents: 400 }
  });
  expect(secondWithdraw.statusCode).toBe(409);
  expect(secondWithdraw.json().error).toBe("DAILY_LIMIT_EXCEEDED");
});

test("insufficient funds returns 409", async () => {
  const createRes = await createAccount({
    dailyWithdrawalLimitCents: 5000,
    initialBalanceCents: 1000
  });
  const account = createRes.json();

  const withdrawRes = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    payload: { amountCents: 2000 }
  });

  expect(withdrawRes.statusCode).toBe(409);
  expect(withdrawRes.json().error).toBe("INSUFFICIENT_FUNDS");
});

test("daily limit exact boundary then exceed by 1 cent", async () => {
  const createRes = await createAccount({
    dailyWithdrawalLimitCents: 1000,
    initialBalanceCents: 5000
  });
  const account = createRes.json();

  const firstWithdraw = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    payload: { amountCents: 1000 }
  });
  expect(firstWithdraw.statusCode).toBe(200);

  const secondWithdraw = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    payload: { amountCents: 1 }
  });
  expect(secondWithdraw.statusCode).toBe(409);
  expect(secondWithdraw.json().error).toBe("DAILY_LIMIT_EXCEEDED");
});

test("zero or negative amounts return 400 invalid amount", async () => {
  const createRes = await createAccount({
    dailyWithdrawalLimitCents: 1000,
    initialBalanceCents: 5000
  });
  const account = createRes.json();

  const depositZero = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/deposit`,
    payload: { amountCents: 0 }
  });
  expect(depositZero.statusCode).toBe(400);
  expect(depositZero.json().error).toBe("INVALID_AMOUNT");

  const withdrawZero = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    payload: { amountCents: 0 }
  });
  expect(withdrawZero.statusCode).toBe(400);
  expect(withdrawZero.json().error).toBe("INVALID_AMOUNT");

  const depositNegative = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/deposit`,
    payload: { amountCents: -1 }
  });
  expect(depositNegative.statusCode).toBe(400);
  expect(depositNegative.json().error).toBe("INVALID_AMOUNT");

  const withdrawNegative = await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    payload: { amountCents: -1 }
  });
  expect(withdrawNegative.statusCode).toBe(400);
  expect(withdrawNegative.json().error).toBe("INVALID_AMOUNT");
});

test("statement filter is inclusive and ordered", async () => {
  nowValue = new Date("2024-01-01T10:00:00Z");
  const createRes = await createAccount({
    dailyWithdrawalLimitCents: 5000,
    initialBalanceCents: 10000
  });
  const account = createRes.json();

  await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    payload: { amountCents: 100 }
  });

  nowValue = new Date("2024-01-02T10:00:00Z");
  await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/deposit`,
    payload: { amountCents: 200 }
  });

  const statementDay1 = await app.inject({
    method: "GET",
    url: `/accounts/${account.accountId}/statement?from=2024-01-01&to=2024-01-01`
  });
  expect(statementDay1.statusCode).toBe(200);
  const day1Summary = statementDay1.json();
  expect(day1Summary.transactions).toHaveLength(2);
  expect(day1Summary.totalIn).toBe(10000);
  expect(day1Summary.totalOut).toBe(100);
  expect(day1Summary.openingBalance).toBe(0);

  const statementAll = await app.inject({
    method: "GET",
    url: `/accounts/${account.accountId}/statement?from=2024-01-01&to=2024-01-02`
  });
  expect(statementAll.statusCode).toBe(200);
  const allSummary = statementAll.json();
  expect(allSummary.transactions).toHaveLength(3);
  expect(
    allSummary.transactions[0].transactionDate <=
      allSummary.transactions[1].transactionDate
  ).toBe(true);

  nowValue = new Date("2024-01-03T00:00:00Z");
});

test("initial balance is recorded as a transaction", async () => {
  nowValue = new Date("2024-02-01T10:00:00Z");
  const createRes = await createAccount({
    dailyWithdrawalLimitCents: 5000,
    initialBalanceCents: 2500
  });
  const account = createRes.json();

  const statementRes = await app.inject({
    method: "GET",
    url: `/accounts/${account.accountId}/statement?from=2024-02-01&to=2024-02-01`
  });

  expect(statementRes.statusCode).toBe(200);
  const summary = statementRes.json();
  expect(summary.transactions).toHaveLength(1);
  expect(summary.transactions[0].valueCents).toBe(2500);
  expect(summary.totalIn).toBe(2500);
  expect(summary.closingBalance).toBe(2500);
  expect(summary.openingBalance).toBe(0);
});

test("statement pagination returns metadata and slices results", async () => {
  nowValue = new Date("2024-03-01T10:00:00Z");
  const createRes = await createAccount({
    dailyWithdrawalLimitCents: 10000,
    initialBalanceCents: 1000
  });
  const account = createRes.json();

  await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/deposit`,
    payload: { amountCents: 100 }
  });
  await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/deposit`,
    payload: { amountCents: 200 }
  });
  await app.inject({
    method: "POST",
    url: `/accounts/${account.accountId}/withdraw`,
    payload: { amountCents: 50 }
  });

  const day = "2024-03-01";
  const page1 = await app.inject({
    method: "GET",
    url: `/accounts/${account.accountId}/statement?from=${day}&to=${day}&limit=2&offset=0`
  });
  expect(page1.statusCode).toBe(200);
  const page1Json = page1.json();
  expect(page1Json.transactions).toHaveLength(2);
  expect(page1Json.totalCount).toBeGreaterThanOrEqual(4);
  expect(page1Json.limit).toBe(2);
  expect(page1Json.offset).toBe(0);
  expect(typeof page1Json.hasMore).toBe("boolean");

  const page2 = await app.inject({
    method: "GET",
    url: `/accounts/${account.accountId}/statement?from=${day}&to=${day}&limit=2&offset=2`
  });
  expect(page2.statusCode).toBe(200);
  const page2Json = page2.json();
  expect(page2Json.offset).toBe(2);
});
