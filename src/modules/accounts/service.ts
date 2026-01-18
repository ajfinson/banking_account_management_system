import {
  AccountBlockedError,
  DailyLimitExceededError,
  InsufficientFundsError,
  InvalidAmountError,
  NotFoundError
} from "../../common/errors";
import {
  Account,
  AccountsRepository,
  CreateAccountInput
} from "./repository";
import { TransactionsRepository } from "../transactions/transactions.repository";
import { MutexMap } from "../../infra/memory/mutex";

export type CreateAccountRequest = {
  personId: string;
  dailyWithdrawalLimitCents: number;
  accountType: string;
  initialBalanceCents?: number;
};

export class AccountsService {
  constructor(
    private readonly accountsRepo: AccountsRepository,
    private readonly transactionsRepo: TransactionsRepository,
    private readonly mutexMap: MutexMap
  ) {}

  async createAccount(input: CreateAccountRequest): Promise<Account> {
    const initialBalanceCents = input.initialBalanceCents ?? 0;
    if (initialBalanceCents < 0) {
      throw new InvalidAmountError("Initial balance must be non-negative");
    }

    const accountInput: CreateAccountInput = {
      personId: input.personId,
      dailyWithdrawalLimitCents: input.dailyWithdrawalLimitCents,
      accountType: input.accountType,
      balanceCents: initialBalanceCents,
      activeFlag: true,
      createDate: new Date().toISOString()
    };

    return this.accountsRepo.create(accountInput);
  }

  async getBalance(accountId: string): Promise<{ balanceCents: number }> {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    return { balanceCents: account.balanceCents };
  }

  async blockAccount(accountId: string): Promise<Account> {
    return this.accountsRepo.setActiveFlag(accountId, false);
  }

  async deposit(
    accountId: string,
    amountCents: number
  ): Promise<{ balanceCents: number; transactionId: string }> {
    if (amountCents <= 0) {
      throw new InvalidAmountError();
    }

    const mutex = this.mutexMap.get(accountId);
    const release = await mutex.lock();
    try {
      const account = await this.accountsRepo.getById(accountId);
      if (!account) {
        throw new NotFoundError();
      }
      if (!account.activeFlag) {
        throw new AccountBlockedError();
      }

      const tx = await this.transactionsRepo.create({
        accountId,
        valueCents: amountCents,
        transactionDate: new Date().toISOString()
      });

      const updated = await this.accountsRepo.updateBalance(
        accountId,
        account.balanceCents + amountCents
      );

      return { balanceCents: updated.balanceCents, transactionId: tx.transactionId };
    } finally {
      release();
    }
  }

  async withdraw(
    accountId: string,
    amountCents: number
  ): Promise<{ balanceCents: number; transactionId: string }> {
    if (amountCents <= 0) {
      throw new InvalidAmountError();
    }

    const mutex = this.mutexMap.get(accountId);
    const release = await mutex.lock();
    try {
      const account = await this.accountsRepo.getById(accountId);
      if (!account) {
        throw new NotFoundError();
      }
      if (!account.activeFlag) {
        throw new AccountBlockedError();
      }
      if (account.balanceCents < amountCents) {
        throw new InsufficientFundsError();
      }

      const today = new Date().toISOString().slice(0, 10);
      const withdrawals = await this.transactionsRepo.sumWithdrawalsForDay(
        accountId,
        today
      );

      if (withdrawals + amountCents > account.dailyWithdrawalLimitCents) {
        throw new DailyLimitExceededError();
      }

      const tx = await this.transactionsRepo.create({
        accountId,
        valueCents: -amountCents,
        transactionDate: new Date().toISOString()
      });

      const updated = await this.accountsRepo.updateBalance(
        accountId,
        account.balanceCents - amountCents
      );

      return { balanceCents: updated.balanceCents, transactionId: tx.transactionId };
    } finally {
      release();
    }
  }

  async statement(
    accountId: string,
    from?: string,
    to?: string
  ) {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    return this.transactionsRepo.listByAccount(accountId, from, to);
  }
}
