# Architecture

## Overview
This service uses a clean architecture approach with explicit boundaries between HTTP, domain logic, and persistence. It is designed to support multiple storage backends without changing business rules.

## Repository Pattern
Two repository interfaces define the storage contracts:

- `AccountsRepository` in [src/modules/accounts/repository.ts](src/modules/accounts/repository.ts)
- `TransactionsRepository` in [src/modules/transactions/transactions.repository.ts](src/modules/transactions/transactions.repository.ts)

Each interface has two implementations:

- **Memory**: [src/infra/memory/memoryAccountsRepo.ts](src/infra/memory/memoryAccountsRepo.ts), [src/infra/memory/memoryTransactionsRepo.ts](src/infra/memory/memoryTransactionsRepo.ts)
- **Postgres**: [src/infra/postgres/postgresAccountsRepo.ts](src/infra/postgres/postgresAccountsRepo.ts), [src/infra/postgres/postgresTransactionsRepo.ts](src/infra/postgres/postgresTransactionsRepo.ts)

The domain service only depends on the interfaces, not the concrete implementations, so the storage layer is swappable.

## Dependency Injection
Dependency injection is centralized in [src/di.ts](src/di.ts). The `createContainer` function chooses implementations based on configuration:

- `REPO_PROVIDER=memory` → in‑memory repositories
- `REPO_PROVIDER=postgres` → Postgres repositories

This allows swapping persistence without changing any business logic or HTTP handlers.

## Services and Domain Logic
`AccountsService` in [src/modules/accounts/service.ts](src/modules/accounts/service.ts) contains the business rules:

- Positive amount validation
- Active account enforcement
- Overdraft prevention
- Daily withdrawal limit checks
- Atomic deposit/withdraw operations

Because it depends only on repository interfaces, the service is decoupled from data storage.

## Concurrency Control
- **In-memory**: per‑account mutex in [src/infra/memory/mutex.ts](src/infra/memory/mutex.ts) serializes deposits/withdrawals to prevent race conditions.
- **Postgres**: database transactions and `SELECT ... FOR UPDATE` are used to lock the account row and ensure atomicity.

## Error Handling
The AppError hierarchy in [src/common/errors.ts](src/common/errors.ts) represents domain errors (e.g., insufficient funds). The Fastify error handler translates these into consistent HTTP responses:

```
{ "error": "CODE", "message": "..." }
```

## HTTP Layer
Routes in [src/modules/accounts/routes.ts](src/modules/accounts/routes.ts) validate input using Zod schemas and delegate to the controller and service. Swagger UI provides API documentation at `/docs`.

## Configuration
Typed configuration is in [src/config.ts](src/config.ts), with validation via Zod. `.env` (loaded by dotenv) controls runtime configuration such as `REPO_PROVIDER`, `DATABASE_URL`, `PORT`, and `HOST`.
