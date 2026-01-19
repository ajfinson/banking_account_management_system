import { AccountsController } from "./modules/accounts/controller";
import { AccountsService } from "./modules/accounts/service";
import { MemoryAccountsRepository } from "./infra/memory/memoryAccountsRepo";
import { MemoryTransactionsRepository } from "./infra/memory/memoryTransactionsRepo";
import { MutexMap } from "./infra/memory/mutex";
import { PostgresAccountsRepository } from "./infra/postgres/postgresAccountsRepo";
import { PostgresTransactionsRepository } from "./infra/postgres/postgresTransactionsRepo";

export type ContainerOptions = {
  now?: () => Date;
};

export function createContainer(options: ContainerOptions = {}) {
  const usePostgres = process.env.REPO_PROVIDER === "postgres";
  const accountsRepo = usePostgres
    ? new PostgresAccountsRepository()
    : new MemoryAccountsRepository();
  const transactionsRepo = usePostgres
    ? new PostgresTransactionsRepository()
    : new MemoryTransactionsRepository();
  const mutexMap = new MutexMap();
  const accountsService = new AccountsService(
    accountsRepo,
    transactionsRepo,
    mutexMap,
    options.now
  );
  const accountsController = new AccountsController(accountsService);

  return {
    accountsRepo,
    transactionsRepo,
    accountsService,
    accountsController
  };
}
