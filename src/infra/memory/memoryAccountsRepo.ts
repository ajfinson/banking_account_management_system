import { randomUUID } from "crypto";
import {
  Account,
  AccountsRepository,
  CreateAccountInput
} from "../../modules/accounts/repository";
import { NotFoundError, PersonNotFoundError } from "../../common/errors";

export class MemoryAccountsRepository implements AccountsRepository {
  private readonly accounts = new Map<string, Account>();
  private readonly validPersonIds = new Set([
    "person-1",
    "person-2",
    "person-3",
    "person-4"
  ]);

  async create(input: CreateAccountInput): Promise<Account> {
    if (!this.validPersonIds.has(input.personId)) {
      throw new PersonNotFoundError();
    }
    const account: Account = {
      ...input,
      accountId: randomUUID()
    };
    this.accounts.set(account.accountId, account);
    return account;
  }

  async getById(accountId: string): Promise<Account | null> {
    return this.accounts.get(accountId) ?? null;
  }

  async setActiveFlag(accountId: string, activeFlag: boolean): Promise<Account> {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    const updated: Account = { ...account, activeFlag };
    this.accounts.set(accountId, updated);
    return updated;
  }

  async updateBalance(accountId: string, balanceCents: number): Promise<Account> {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    const updated: Account = { ...account, balanceCents };
    this.accounts.set(accountId, updated);
    return updated;
  }
}
