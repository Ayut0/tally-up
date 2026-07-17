CREATE TABLE members (
  id         UUID PRIMARY KEY,
  name       TEXT NOT NULL
);

CREATE TABLE groups (
  id         UUID PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id   UUID NOT NULL REFERENCES groups(id),
  member_id  UUID NOT NULL REFERENCES members(id),
  PRIMARY KEY (group_id, member_id)
);

CREATE TABLE entries (
  id           UUID PRIMARY KEY,
  seq          BIGSERIAL UNIQUE,
  group_id     UUID NOT NULL REFERENCES groups(id),
  kind         TEXT NOT NULL CHECK (kind IN ('expense','settlement','reversal')),
  reverses_id  UUID REFERENCES entries(id),
  payer_id     UUID NOT NULL REFERENCES members(id),
  counterparty UUID REFERENCES members(id),
  total_amount BIGINT NOT NULL CHECK (total_amount > 0),
  split_rule   JSONB NOT NULL,
  participants UUID[] NOT NULL,
  plan_seq     BIGINT,
  memo         TEXT,
  occurred_on  DATE NOT NULL,
  created_by   UUID NOT NULL REFERENCES members(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX entries_group_seq ON entries (group_id, seq);

CREATE TABLE postings (
  entry_id   UUID NOT NULL REFERENCES entries(id),
  member_id  UUID NOT NULL REFERENCES members(id),
  amount     BIGINT NOT NULL,
  PRIMARY KEY (entry_id, member_id)
);

CREATE TABLE idempotency_keys (
  key           UUID PRIMARY KEY,
  request_hash  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','succeeded')),
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE VIEW balances AS
SELECT e.group_id, p.member_id, SUM(p.amount) AS balance
FROM postings p JOIN entries e ON e.id = p.entry_id
GROUP BY e.group_id, p.member_id;

-- The ledger is append-only: row-level UPDATE/DELETE are forbidden.
-- (TRUNCATE bypasses row triggers, which keeps test resets possible.)
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only: % on % forbidden', TG_OP, TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER entries_append_only
  BEFORE UPDATE OR DELETE ON entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER postings_append_only
  BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
