export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Account not found") {
    super("NOT_FOUND", 404, message);
  }
}

export class AccountBlockedError extends AppError {
  constructor(message = "Account is blocked") {
    super("ACCOUNT_BLOCKED", 409, message);
  }
}

export class InvalidAmountError extends AppError {
  constructor(message = "Amount must be greater than zero") {
    super("INVALID_AMOUNT", 400, message);
  }
}

export class InsufficientFundsError extends AppError {
  constructor(message = "Insufficient funds") {
    super("INSUFFICIENT_FUNDS", 409, message);
  }
}

export class DailyLimitExceededError extends AppError {
  constructor(message = "Daily withdrawal limit exceeded") {
    super("DAILY_LIMIT_EXCEEDED", 409, message);
  }
}
