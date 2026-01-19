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
  const day1List = statementDay1.json();
  expect(day1List).toHaveLength(1);
  expect(day1List[0].valueCents).toBe(-100);

  const statementAll = await app.inject({
    method: "GET",
    url: `/accounts/${account.accountId}/statement?from=2024-01-01&to=2024-01-02`
  });
  expect(statementAll.statusCode).toBe(200);
  const allList = statementAll.json();
  expect(allList).toHaveLength(2);
  expect(allList[0].transactionDate <= allList[1].transactionDate).toBe(true);

  nowValue = new Date("2024-01-03T00:00:00Z");
});
