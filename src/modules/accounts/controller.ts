import { AccountsService, CreateAccountRequest } from "./service";

export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  createAccount(input: CreateAccountRequest) {
    return this.service.createAccount(input);
  }

  deposit(accountId: string, amountCents: number) {
    return this.service.deposit(accountId, amountCents);
  }

  withdraw(accountId: string, amountCents: number) {
    return this.service.withdraw(accountId, amountCents);
  }

  getBalance(accountId: string) {
    return this.service.getBalance(accountId);
  }

  blockAccount(accountId: string) {
    return this.service.blockAccount(accountId);
  }

  unblockAccount(accountId: string) {
    return this.service.unblockAccount(accountId);
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
