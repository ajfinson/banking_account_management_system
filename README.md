# Banking Account Management API

Fastify + TypeScript REST API for banking accounts using clean architecture and in-memory repositories (swappable later).

## Prerequisites

- Node.js 18+ (recommended)
- npm 9+
- Postgres 14+ (only if using `REPO_PROVIDER=postgres`)

## Run server

1. Install dependencies: `npm install`
2. Start dev server: `npm run dev`

The server listens on `http://localhost:3000` by default.

### API docs and health

- Swagger UI: http://localhost:3000/docs
- OpenAPI JSON: http://localhost:3000/docs/json
- Health check: http://localhost:3000/health
- DB health check: http://localhost:3000/health/db (only in Postgres mode)
- Every response includes an `x-request-id` header for traceability.

### Rate limiting

Default limit is 100 requests per minute. Configure via:

- `RATE_LIMIT_MAX`
- `RATE_LIMIT_WINDOW_MS`

### Using Postgres

1. Create the database and run [scripts/schema.sql](scripts/schema.sql).
2. Seed the person table with [scripts/seed.sql](scripts/seed.sql).
3. Create a local .env from [.env.example](.env.example) and fill in values (loaded automatically).
4. Or set environment variables directly:

```
DATABASE_URL=postgres://user:password@localhost:5432/bank
REPO_PROVIDER=postgres
```

Then run `npm run dev`.

### Postgres setup helpers (optional)

- Use pgAdmin Query Tool to execute [scripts/schema.sql](scripts/schema.sql) and [scripts/seed.sql](scripts/seed.sql).
- Or use psql:

```
psql -U postgres -d bank -f scripts/schema.sql
psql -U postgres -d bank -f scripts/seed.sql
```

## Run tests

### Quick tests (Memory mode)
```bash
npm test
# or specifically:
npm run test:fast
```

Runs core unit and concurrency tests (~3 seconds).

### Full test suite (Postgres required)
```bash
# Set up test database
export DATABASE_URL="postgresql://user:password@localhost:5432/banking_test"
psql $DATABASE_URL -f scripts/schema.sql
psql $DATABASE_URL -f scripts/seed.sql

# Run all tests
REPO_PROVIDER=postgres npm run test:all
```

### Test categories

| Command | Tests | Duration | Database | Purpose |
|---------|-------|----------|----------|---------|
| `npm test` | Unit + Concurrency | ~3s | Memory | Fast feedback |
| `npm run test:integration` | Error handling | ~15s | Postgres | Resilience |
| `npm run test:load` | Load tests | ~2min | Postgres | Performance |
| `npm run test:chaos` | Chaos engineering | ~2min | Postgres | Edge cases |

See [TESTING.md](TESTING.md) for detailed testing documentation.

### Test coverage

- ✅ **Unit tests**: Business logic, validation, edge cases
- ✅ **Concurrency tests**: Race conditions, mutex behavior
- ✅ **Error handling**: Connection failures, retry exhaustion, rollbacks
- ✅ **Load tests**: 500+ concurrent operations, pool exhaustion
- ✅ **Chaos tests**: Clock skew, extreme values, long transactions

## API endpoints

All monetary values are **integer cents**.

### Create account

- **POST /accounts**
- Body:
  - `personId` (string, required)
  - `dailyWithdrawalLimitCents` (integer ≥ 0, required)
  - `accountType` (enum: `checking` | `savings` | `investment`, required)
  - `initialBalanceCents` (integer ≥ 0, optional)

Example request:

```
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"personId":"person-1","dailyWithdrawalLimitCents":5000,"accountType":"checking","initialBalanceCents":10000}'
```

Example response:

```
{
  "accountId": "...",
  "personId": "person-1",
  "balanceCents": 10000,
  "dailyWithdrawalLimitCents": 5000,
  "activeFlag": true,
  "accountType": "checking",
  "createDate": "2024-01-01T10:00:00.000Z"
}
```

Errors:

- 400 `INVALID_REQUEST`
- 404 `PERSON_NOT_FOUND`

### Get balance

- **GET /accounts/:id/balance**

Example response:

```
{ "balanceCents": 10400 }
```

Errors:

- 404 `NOT_FOUND`

### Deposit

- **POST /accounts/:id/deposit**
- Body: `amountCents` (integer > 0)

Example response:

```
{ "balanceCents": 11000, "transactionId": "..." }
```

Errors:

- 400 `INVALID_AMOUNT`
- 404 `NOT_FOUND`
- 409 `ACCOUNT_BLOCKED`

### Withdraw

- **POST /accounts/:id/withdraw**
- Body: `amountCents` (integer > 0)

Example response:

```
{ "balanceCents": 9400, "transactionId": "..." }
```

Errors:

- 400 `INVALID_AMOUNT`
- 404 `NOT_FOUND`
- 409 `ACCOUNT_BLOCKED`
- 409 `INSUFFICIENT_FUNDS`
- 409 `DAILY_LIMIT_EXCEEDED`

### Block account

- **POST /accounts/:id/block**

Errors:

- 404 `NOT_FOUND`
- 409 `ALREADY_BLOCKED`

### Unblock account

- **POST /accounts/:id/unblock**

Errors:

- 404 `NOT_FOUND`
- 409 `ALREADY_UNBLOCKED`

### Account statement

- **GET /accounts/:id/statement**
- Query params (all optional):
  - `from` (YYYY-MM-DD)
  - `to` (YYYY-MM-DD)
  - `limit` (integer > 0)
  - `offset` (integer ≥ 0)

Example response:

```
{
  "openingBalance": 10000,
  "closingBalance": 10400,
  "totalIn": 1000,
  "totalOut": 600,
  "totalCount": 2,
  "limit": 10,
  "offset": 0,
  "hasMore": false,
  "transactions": [
    {
      "transactionId": "...",
      "accountId": "...",
      "valueCents": 1000,
      "transactionDate": "2024-01-02T10:00:00.000Z"
    }
  ]
}
```

Errors:

- 404 `NOT_FOUND`

## Design notes

- **Cents**: all monetary values are stored in cents to avoid floating point errors.
- **Negative transactions**: withdrawals create a transaction with a negative `valueCents`.
- **Mutex**: deposit/withdraw are serialized per account with an in-memory mutex to guarantee atomicity.
- **Daily limit**: enforced per UTC calendar day (00:00–23:59 UTC).
- **Repository pattern**: `AccountsRepository` and `TransactionsRepository` are interfaces so the storage layer can be swapped later.

## Scaling notes

- In-memory mode is **single-process only** and **not durable**.
- Postgres mode supports multi-instance deployments with transactional safety.
