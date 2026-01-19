INSERT INTO person (person_id, full_name)
VALUES
	('person-1', 'Ava Patel'),
	('person-2', 'Liam Chen'),
	('person-3', 'Maya Johnson'),
	('person-4', 'Noah Garcia');

INSERT INTO account (
	account_id,
	person_id,
	balance_cents,
	daily_withdrawal_limit_cents,
	active_flag,
	account_type,
	create_date
)
VALUES
	('acct-1', 'person-1', 250000, 50000, true, 'checking', '2024-01-01T10:00:00Z'),
	('acct-2', 'person-1', 800000, 200000, true, 'savings', '2024-01-05T12:00:00Z'),
	('acct-3', 'person-2', 120000, 30000, true, 'checking', '2024-02-01T09:30:00Z'),
	('acct-4', 'person-3', 45000, 15000, false, 'checking', '2024-02-15T08:15:00Z');

INSERT INTO transactions (
	transaction_id,
	account_id,
	value_cents,
	transaction_date
)
VALUES
	('tx-1', 'acct-1', 50000, '2024-03-01T08:00:00Z'),
	('tx-2', 'acct-1', -20000, '2024-03-01T12:00:00Z'),
	('tx-3', 'acct-2', 100000, '2024-03-02T10:00:00Z'),
	('tx-4', 'acct-3', -5000, '2024-03-03T09:00:00Z');
