CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE person (
  person_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE account (
  account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id TEXT NOT NULL REFERENCES person(person_id),
  balance_cents BIGINT NOT NULL CHECK (balance_cents >= 0 AND balance_cents <= 9007199254740991),
  daily_withdrawal_limit_cents BIGINT NOT NULL CHECK (daily_withdrawal_limit_cents >= 0 AND daily_withdrawal_limit_cents <= 9007199254740991),
  active_flag BOOLEAN NOT NULL DEFAULT true,
  account_type TEXT NOT NULL CHECK (account_type IN ('checking', 'savings', 'investment')),
  create_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transactions (
  transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(account_id),
  value_cents BIGINT NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0 AND balance_after <= 9007199254740991),
  idempotency_key TEXT UNIQUE
);

-- Performance indices
CREATE INDEX idx_transactions_account_id ON transactions(account_id);
CREATE INDEX idx_transactions_account_date ON transactions(account_id, transaction_date ASC);
CREATE INDEX idx_transactions_account_withdrawals ON transactions(account_id, transaction_date) 
  WHERE value_cents < 0;
CREATE INDEX idx_transactions_idempotency_key ON transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Audit trail for account status changes
CREATE TABLE account_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(account_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('BLOCKED', 'UNBLOCKED')),
  event_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_id TEXT
);

CREATE INDEX idx_account_events_account_id ON account_events(account_id, event_date DESC);
