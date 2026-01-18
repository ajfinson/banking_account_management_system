import { AccountsController } from "./modules/accounts/controller";
import { AccountsService } from "./modules/accounts/service";
import { MemoryAccountsRepository } from "./infra/memory/memoryAccountsRepo";
import { MemoryTransactionsRepository } from "./infra/memory/memoryTransactionsRepo";
import { MutexMap } from "./infra/memory/mutex";

export function createContainer() {
  const accountsRepo = new MemoryAccountsRepository();
  const transactionsRepo = new MemoryTransactionsRepository();
  const mutexMap = new MutexMap();
  const accountsService = new AccountsService(
    accountsRepo,
    transactionsRepo,
    mutexMap
  );
  const accountsController = new AccountsController(accountsService);

  return {
    accountsRepo,
    transactionsRepo,
    accountsService,
    accountsController
  };
}
