# Banking Account Management API

Fastify + TypeScript REST API for banking accounts using clean architecture and in-memory repositories (swappable later).

## Run server

1. Install dependencies: `npm install`
2. Start dev server: `npm run dev`

The server listens on `http://localhost:3000` by default.

### API docs and health

- Swagger UI: http://localhost:3000/docs
- OpenAPI JSON: http://localhost:3000/docs/json
- Health check: http://localhost:3000/health
- Every response includes an `x-request-id` header for traceability.

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

## Run tests

`npm test`

## Example curl

Create account (curl):

```
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"personId":"person-1","dailyWithdrawalLimitCents":5000,"accountType":"checking","initialBalanceCents":10000}'
```

Create account (PowerShell):

```
Invoke-WebRequest -Method Post -Uri http://localhost:3000/accounts `
  -ContentType "application/json" `
  -Body '{"personId":"person-1","dailyWithdrawalLimitCents":5000,"accountType":"checking","initialBalanceCents":10000}'
```

Deposit (curl):

```
curl -X POST http://localhost:3000/accounts/<id>/deposit \
  -H "Content-Type: application/json" \
  -d '{"amountCents":2500}'
```

Deposit (PowerShell):

```
Invoke-WebRequest -Method Post -Uri http://localhost:3000/accounts/<id>/deposit `
  -ContentType "application/json" `
  -Body '{"amountCents":2500}'
```

Withdraw (curl):

```
curl -X POST http://localhost:3000/accounts/<id>/withdraw \
  -H "Content-Type: application/json" \
  -d '{"amountCents":1500}'
```

Withdraw (PowerShell):

```
Invoke-WebRequest -Method Post -Uri http://localhost:3000/accounts/<id>/withdraw `
  -ContentType "application/json" `
  -Body '{"amountCents":1500}'
```

Statement (curl):

```
curl "http://localhost:3000/accounts/<id>/statement?from=2024-01-01&to=2024-01-31"
```

Statement (PowerShell):

```
Invoke-WebRequest -Method Get -Uri "http://localhost:3000/accounts/<id>/statement?from=2024-01-01&to=2024-01-31"
```

## Design notes

- **Cents**: all monetary values are stored in cents to avoid floating point errors.
- **Negative transactions**: withdrawals create a transaction with a negative `valueCents`.
- **Mutex**: deposit/withdraw are serialized per account with an in-memory mutex to guarantee atomicity.
- **Repository pattern**: `AccountsRepository` and `TransactionsRepository` are interfaces so the storage layer can be swapped later.
