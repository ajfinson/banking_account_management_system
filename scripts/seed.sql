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
	('a1b2c3d4-1111-4444-8888-111111111111', 'person-1', 250000, 50000, true, 'checking', '2024-01-01T10:00:00Z'),
	('a1b2c3d4-2222-4444-8888-222222222222', 'person-1', 800000, 200000, true, 'savings', '2024-01-05T12:00:00Z'),
	('a1b2c3d4-3333-4444-8888-333333333333', 'person-2', 120000, 30000, true, 'checking', '2024-02-01T09:30:00Z'),
	('a1b2c3d4-4444-4444-8888-444444444444', 'person-3', 45000, 15000, false, 'checking', '2024-02-15T08:15:00Z');

INSERT INTO transactions (
	transaction_id,
	account_id,
	value_cents,
	transaction_date,
	balance_after
)
VALUES
	('b1c2d3e4-1111-4444-8888-111111111111', 'a1b2c3d4-1111-4444-8888-111111111111', 50000, '2024-03-01T08:00:00Z', 300000),
	('b1c2d3e4-2222-4444-8888-222222222222', 'a1b2c3d4-1111-4444-8888-111111111111', -20000, '2024-03-01T12:00:00Z', 280000),
	('b1c2d3e4-3333-4444-8888-333333333333', 'a1b2c3d4-2222-4444-8888-222222222222', 100000, '2024-03-02T10:00:00Z', 900000),
	('b1c2d3e4-4444-4444-8888-444444444444', 'a1b2c3d4-3333-4444-8888-333333333333', -5000, '2024-03-03T09:00:00Z', 115000);
