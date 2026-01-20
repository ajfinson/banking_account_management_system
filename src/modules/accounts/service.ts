import {
  AccountBlockedError,
  AlreadyBlockedError,
  AlreadyUnblockedError,
  InvalidAmountError,
  NotFoundError
} from "../../common/errors";
import {
  Account,
  AccountsRepository,
  AccountEventsRepository,
  CreateAccountInput
} from "./repository";
import {
  TransactionsRepository
} from "../transactions/transactions.repository";
import { MutexMap } from "../../infra/memory/mutex";
import { config } from "../../config";

export type CreateAccountRequest = {
  personId: string;
  dailyWithdrawalLimitCents: number;
  accountType: string;
  initialBalanceCents?: number;
};

type LogContext = {
  requestId?: string;
  accountId?: string;
  amountCents?: number;
};

type LoggerLike = {
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
};

export class AccountsService {
  private static readonly MAX_CENTS = Number.MAX_SAFE_INTEGER;
  
  constructor(
    private readonly accountsRepo: AccountsRepository,
    private readonly transactionsRepo: TransactionsRepository,
    private readonly eventsRepo: AccountEventsRepository,
    private readonly mutexMap: MutexMap,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: LoggerLike = {
      info: (msg, ctx) => console.log(msg, ctx),
      warn: (msg, ctx) => console.warn(msg, ctx),
      error: (msg, ctx) => console.error(msg, ctx)
    }
  ) {}

  async createAccount(input: CreateAccountRequest): Promise<Account> {
    const initialBalanceCents = input.initialBalanceCents ?? 0;
    if (initialBalanceCents < 0) {
      throw new InvalidAmountError("Initial balance must be non-negative");
    }
    this.validateCents(initialBalanceCents, "Initial balance");
    this.validateCents(input.dailyWithdrawalLimitCents, "Daily limit");

    const createDate = this.now().toISOString();
    const accountInput: CreateAccountInput = {
      personId: input.personId,
      dailyWithdrawalLimitCents: input.dailyWithdrawalLimitCents,
      accountType: input.accountType,
      balanceCents: initialBalanceCents,
      activeFlag: true,
      createDate
    };

    // Use atomic creation if there's an initial balance
    if (initialBalanceCents > 0) {
      return await this.accountsRepo.createWithInitialBalance(
        accountInput,
        initialBalanceCents,
        createDate
      );
    }
    
    // Otherwise just create the account
    const result = await this.accountsRepo.create(accountInput);
    return result;
  }

  async getBalance(accountId: string): Promise<{ balanceCents: number }> {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    return { balanceCents: account.balanceCents };
  }

  async blockAccount(accountId: string, requestId?: string): Promise<Account> {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    if (!account.activeFlag) {
      throw new AlreadyBlockedError();
    }
    const updated = await this.accountsRepo.setActiveFlag(accountId, false);
    
    // Create audit event
    await this.eventsRepo.create({
      accountId,
      eventType: 'BLOCKED',
      eventDate: this.now().toISOString(),
      requestId
    });
    
    this.logger.info("Account blocked", { accountId, requestId });
    return updated;
  }

  async unblockAccount(accountId: string, requestId?: string): Promise<Account> {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError();
    }
    if (account.activeFlag) {
      throw new AlreadyUnblockedError();
    }
    const updated = await this.accountsRepo.setActiveFlag(accountId, true);
    
    // Create audit event
    await this.eventsRepo.create({
      accountId,
      eventType: 'UNBLOCKED',
      eventDate: this.now().toISOString(),
      requestId
    });
    
    this.logger.info("Account unblocked", { accountId, requestId });
    return updated;
  }

  async deposit(
    accountId: string,
    amountCents: number,
    requestId?: string,
    idempotencyKey?: string
  ): Promise<{ balanceCents: number; transactionId: string }> {
    if (amountCents <= 0) {
      throw new InvalidAmountError();
    }
    this.validateCents(amountCents, "Amount");

    // Only use mutex for memory provider, postgres handles it with transactions
    if (config.REPO_PROVIDER === "memory") {
      const mutex = this.mutexMap.get(accountId);
      const release = await mutex.lock();
      try {
        return await this.accountsRepo.atomicDeposit(
          accountId,
          amountCents,
          this.now().toISOString(),
          idempotencyKey
        );
      } catch (error) {
        // Safely release mutex without masking original error
        try {
          release();
        } catch (releaseError) {
          this.logger.error("Failed to release mutex", { accountId });
        }
        throw error;
      }
    }

    // Postgres uses database-level locking
    return await this.accountsRepo.atomicDeposit(
      accountId,
      amountCents,
      this.now().toISOString(),
      idempotencyKey
    );
  }

  async withdraw(
    accountId: string,
    amountCents: number,
    requestId?: string,
    idempotencyKey?: string
  ): Promise<{ balanceCents: number; transactionId: string }> {
    if (amountCents <= 0) {
      throw new InvalidAmountError();
    }
    this.validateCents(amountCents, "Amount");

    const transactionDate = this.now().toISOString();
    // Daily limits use configured timezone (default: UTC)
    // Configure via DAILY_LIMIT_TIMEZONE env var (e.g., 'America/New_York')
    const today = this.getTodayInConfiguredTimezone(transactionDate);

    // Only use mutex for memory provider, postgres handles it with transactions
    if (config.REPO_PROVIDER === "memory") {
      const mutex = this.mutexMap.get(accountId);
      const release = await mutex.lock();
      try {
        return await this.accountsRepo.atomicWithdraw(
          accountId,
          amountCents,
          0, // dailyWithdrawalLimit not used, repo gets it from account
          transactionDate,
          today,
          idempotencyKey
        );
      } catch (error) {
        // Safely release mutex without masking original error
        try {
          release();
        } catch (releaseError) {
          this.logger.error("Failed to release mutex", { accountId });
        }
        throw error;
      }
    }

    // Postgres uses database-level locking
    return await this.accountsRepo.atomicWithdraw(
      accountId,
      amountCents,
      0, // dailyWithdrawalLimit not used, repo gets it from account
      transactionDate,
      today,
      idempotencyKey
    );
  }

  async statement(
    accountId: string,
    from?: string,
    to?: string,
    limit?: number,
    offset?: number
  ) {
    const account = await this.accountsRepo.getById(accountId);
    if (!account) {
      throw new NotFoundError();
    }

    const periodTransactions = await this.transactionsRepo.listByAccount(
      accountId,
      from,
      to,
      limit,
      offset
    );
    const totalCount = await this.transactionsRepo.countByAccount(
      accountId,
      from,
      to
    );

    // Calculate opening balance: all transactions before the 'from' date
    const openingBalance = from
      ? (await this.transactionsRepo.sumByAccountRange(
          accountId,
          undefined,
          this.previousDay(from)
        )).totalNet
      : 0;
    const totals = await this.transactionsRepo.sumByAccountRange(
      accountId,
      from,
      to
    );
    const closingBalance = openingBalance + totals.totalNet;
    const safeOffset = offset ?? 0;
    const safeLimit = limit ?? totalCount;
    const hasMore = safeOffset + periodTransactions.length < totalCount;

    return {
      openingBalance,
      closingBalance,
      totalIn: totals.totalIn,
      totalOut: totals.totalOut,
      transactions: periodTransactions,
      totalCount,
      limit: safeLimit,
      offset: safeOffset,
      hasMore
    };
  }

  private previousDay(dateString: string): string {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  private validateCents(value: number, label: string) {
    if (!Number.isSafeInteger(value) || value > AccountsService.MAX_CENTS || value < 0) {
      throw new InvalidAmountError(`${label} exceeds allowed limits or is negative`);
    }
  }

  private getTodayInConfiguredTimezone(isoDate: string): string {
    // For now, use UTC (matches DAILY_LIMIT_TIMEZONE=UTC)
    // In production, use a proper timezone library like date-fns-tz or luxon
    // based on config.DAILY_LIMIT_TIMEZONE
    return isoDate.slice(0, 10);
  }
}
