export type Account = {
  accountId: string;
  personId: string;
  balanceCents: number;
  dailyWithdrawalLimitCents: number;
  activeFlag: boolean;
  accountType: string;
  createDate: string;
};

export type CreateAccountInput = Omit<Account, "accountId" | "createDate"> & {
  createDate?: string;
};

export interface AccountsRepository {
  create(input: CreateAccountInput): Promise<Account>;
  getById(accountId: string): Promise<Account | null>;
  setActiveFlag(accountId: string, activeFlag: boolean): Promise<Account>;
  updateBalance(accountId: string, balanceCents: number): Promise<Account>;
  
  // Transactional operations for atomic deposit/withdraw
  atomicDeposit(
    accountId: string,
    amountCents: number,
    transactionDate: string,
    idempotencyKey?: string
  ): Promise<{ balanceCents: number; transactionId: string }>;
  
  atomicWithdraw(
    accountId: string,
    amountCents: number,
    dailyWithdrawalLimit: number,
    transactionDate: string,
    today: string,
    idempotencyKey?: string
  ): Promise<{ balanceCents: number; transactionId: string }>;
  
  // Create account with initial balance transaction atomically
  createWithInitialBalance(
    input: CreateAccountInput,
    initialBalanceCents: number,
    transactionDate: string
  ): Promise<Account>;
}

export type AccountEvent = {
  eventId: string;
  accountId: string;
  eventType: 'BLOCKED' | 'UNBLOCKED';
  eventDate: string;
  requestId?: string;
};

export interface AccountEventsRepository {
  create(event: Omit<AccountEvent, 'eventId'>): Promise<AccountEvent>;
  listByAccount(accountId: string): Promise<AccountEvent[]>;
}
