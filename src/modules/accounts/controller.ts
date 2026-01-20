import { AccountsService, CreateAccountRequest } from "./service";

export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  createAccount(input: CreateAccountRequest) {
    return this.service.createAccount(input);
  }

  deposit(accountId: string, amountCents: number, requestId?: string, idempotencyKey?: string) {
    return this.service.deposit(accountId, amountCents, requestId, idempotencyKey);
  }

  withdraw(accountId: string, amountCents: number, requestId?: string, idempotencyKey?: string) {
    return this.service.withdraw(accountId, amountCents, requestId, idempotencyKey);
  }

  getBalance(accountId: string) {
    return this.service.getBalance(accountId);
  }

  blockAccount(accountId: string, requestId?: string) {
    return this.service.blockAccount(accountId, requestId);
  }

  unblockAccount(accountId: string, requestId?: string) {
    return this.service.unblockAccount(accountId, requestId);
  }

  statement(
    accountId: string,
    from?: string,
    to?: string,
    limit?: number,
    offset?: number
  ) {
    return this.service.statement(accountId, from, to, limit, offset);
  }
}
