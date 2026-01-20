import { randomUUID } from "crypto";
import {
  Account,
  AccountsRepository,
  CreateAccountInput
} from "../../modules/accounts/repository";
import { 
  NotFoundError, 
  PersonNotFoundError,
  AccountBlockedError,
  InsufficientFundsError,
  DailyLimitExceededError,
  InvalidAmountError
} from "../../common/errors";
import { TransactionsRepository } from "../../modules/transactions/transactions.repository";

export class MemoryAccountsRepository implements AccountsRepository {
  constructor(
    private readonly transactionsRepo?: TransactionsRepository,
    private readonly accounts: Map<string, Account> = new Map(),
    private readonly validPersonIds: Set<string> = new Set([
      "person-1",
      "person-2",
      "person-3",
      "person-4"
    ])
  ) {}

  async create(input: CreateAccountInput): Promise<Account> {
    if (!this.validPersonIds.has(input.personId)) {
      throw new PersonNotFoundError();
    }
    const account: Account = {
      ...input,
      accountId: randomUUID(),
      createDate: input.createDate || new Date().toISOString()
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

  async atomicDeposit(
    accountId: string,
    amountCents: number,
    transactionDate: string,
    idempotencyKey?: string
  ): Promise<{ balanceCents: number; transactionId: string }> {
    // Check for existing transaction with this idempotency key FIRST
    if (idempotencyKey && this.transactionsRepo) {
      const existing = await this.transactionsRepo.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.accountId === accountId) {
          // Same account, same key - return existing result
          return { balanceCents: existing.balanceAfter, transactionId: existing.transactionId };
        } else {
          // Different account with same key - reject
          throw new InvalidAmountError(
            `Idempotency key already used for different account`
          );
        }
      }
    }
    
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    if (!account.activeFlag) {
      throw new AccountBlockedError();
    }
    
    const newBalance = account.balanceCents + amountCents;
    if (newBalance > Number.MAX_SAFE_INTEGER) {
      throw new InvalidAmountError("Balance overflow: result exceeds safe integer limit");
    }
    
    // Create transaction
    if (!this.transactionsRepo) {
      throw new Error("TransactionsRepository required for atomic operations");
    }
    
    const tx = await this.transactionsRepo.create({
      accountId,
      valueCents: amountCents,
      transactionDate,
      balanceAfter: newBalance,
      idempotencyKey
    });
    
    // Update balance
    const updated: Account = { ...account, balanceCents: newBalance };
    this.accounts.set(accountId, updated);
    
    return { balanceCents: newBalance, transactionId: tx.transactionId };
  }

  async atomicWithdraw(
    accountId: string,
    amountCents: number,
    dailyWithdrawalLimit: number,
    transactionDate: string,
    today: string,
    idempotencyKey?: string
  ): Promise<{ balanceCents: number; transactionId: string }> {
    // Check for existing transaction with this idempotency key FIRST
    if (idempotencyKey && this.transactionsRepo) {
      const existing = await this.transactionsRepo.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.accountId === accountId) {
          // Same account, same key - return existing result
          return { balanceCents: existing.balanceAfter, transactionId: existing.transactionId };
        } else {
          // Different account with same key - reject
          throw new InvalidAmountError(
            `Idempotency key already used for different account`
          );
        }
      }
    }
    
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    if (!account.activeFlag) {
      throw new AccountBlockedError();
    }
    if (account.balanceCents < amountCents) {
      // Don't expose exact deficit for security reasons
      throw new InsufficientFundsError();
    }
    
    // Check daily limit
    if (!this.transactionsRepo) {
      throw new Error("TransactionsRepository required for atomic operations");
    }
    
    const dailyWithdrawals = await this.transactionsRepo.sumWithdrawalsForDay(
      accountId,
      today
    );
    
    if (dailyWithdrawals + amountCents > account.dailyWithdrawalLimitCents) {
      throw new DailyLimitExceededError();
    }
    
    // Calculate new balance first
    const newBalance = account.balanceCents - amountCents;
    
    // Defensive check: ensure balance remains non-negative
    if (newBalance < 0) {
      throw new InsufficientFundsError("Balance cannot be negative");
    }
    
    // Create transaction (negative value)
    const tx = await this.transactionsRepo.create({
      accountId,
      valueCents: -amountCents,
      transactionDate,
      balanceAfter: newBalance,
      idempotencyKey
    });
    
    // Update balance
    const updated: Account = { ...account, balanceCents: newBalance };
    this.accounts.set(accountId, updated);
    
    return { balanceCents: newBalance, transactionId: tx.transactionId };
  }

  async createWithInitialBalance(
    input: CreateAccountInput,
    initialBalanceCents: number,
    transactionDate: string
  ): Promise<Account> {
    if (!this.validPersonIds.has(input.personId)) {
      throw new PersonNotFoundError();
    }
    
    // Note: Creating account first, then transaction is NOT atomic in memory mode
    // In production, this would need distributed transaction support or event sourcing
    const account: Account = {
      ...input,
      accountId: randomUUID(),
      createDate: input.createDate || new Date().toISOString()
    };
    
    try {
      // Create initial transaction BEFORE adding account to repository
      // This way if transaction fails, account was never visible
      if (initialBalanceCents > 0 && this.transactionsRepo) {
        await this.transactionsRepo.create({
          accountId: account.accountId,
          valueCents: initialBalanceCents,
          transactionDate,
          balanceAfter: initialBalanceCents
        });
      }
      
      // Only add account after transaction succeeds
      this.accounts.set(account.accountId, account);
      return account;
    } catch (error) {
      // If transaction creation failed, ensure account is not added
      this.accounts.delete(account.accountId);
      throw error;
    }
  }
}
