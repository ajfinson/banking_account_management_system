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
  createDate: string;
};

export interface AccountsRepository {
  create(input: CreateAccountInput): Promise<Account>;
  getById(accountId: string): Promise<Account | null>;
  setActiveFlag(accountId: string, activeFlag: boolean): Promise<Account>;
  updateBalance(accountId: string, balanceCents: number): Promise<Account>;
}
