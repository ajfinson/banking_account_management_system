import { AccountsController } from "./modules/accounts/controller";
import { AccountsService } from "./modules/accounts/service";
import { MemoryAccountsRepository } from "./infra/memory/memoryAccountsRepo";
import { MemoryTransactionsRepository } from "./infra/memory/memoryTransactionsRepo";
import { MemoryAccountEventsRepository } from "./infra/memory/memoryAccountEventsRepo";
import { MutexMap } from "./infra/memory/mutex";
import { PostgresAccountsRepository } from "./infra/postgres/postgresAccountsRepo";
import { PostgresTransactionsRepository } from "./infra/postgres/postgresTransactionsRepo";
import { PostgresAccountEventsRepository } from "./infra/postgres/postgresAccountEventsRepo";
import { config } from "./config";

export type ContainerOptions = {
  now?: () => Date;
  logger?: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
  };
};

export function createContainer(options: ContainerOptions = {}) {
  const usePostgres = config.REPO_PROVIDER === "postgres";
  
  // WARNING: Memory mode is for testing/development only
  // It lacks proper atomicity guarantees and does not persist data
  // Always use postgres provider in production
  
  const transactionsRepo = usePostgres
    ? new PostgresTransactionsRepository()
    : new MemoryTransactionsRepository();
    
  const accountsRepo = usePostgres
    ? new PostgresAccountsRepository(options.logger)
    : new MemoryAccountsRepository(transactionsRepo);
    
  const eventsRepo = usePostgres
    ? new PostgresAccountEventsRepository()
    : new MemoryAccountEventsRepository();
    
  const mutexMap = new MutexMap();
  const accountsService = new AccountsService(
    accountsRepo,
    transactionsRepo,
    eventsRepo,
    mutexMap,
    options.now,
    options.logger
  );
  const accountsController = new AccountsController(accountsService);

  return {
    accountsRepo,
    transactionsRepo,
    accountsService,
    accountsController,
    mutexMap
  };
}
