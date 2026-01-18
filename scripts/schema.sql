CREATE TABLE person (
  person_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE account (
  account_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person(person_id),
  balance_cents INTEGER NOT NULL,
  daily_withdrawal_limit_cents INTEGER NOT NULL,
  active_flag BOOLEAN NOT NULL,
  account_type TEXT NOT NULL,
  create_date TIMESTAMP NOT NULL
);

CREATE TABLE transaction (
  transaction_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(account_id),
  value_cents INTEGER NOT NULL,
  transaction_date TIMESTAMP NOT NULL
);
