package store

import (
	"context"
	"os"
	"testing"
)

func TestMigrationsApplyAndLedgerIsAppendOnly(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()

	// Seed a minimal group so we can insert an entry.
	// (One statement per Exec — pgx v5's extended protocol rejects batches.)
	for _, q := range []string{
		`INSERT INTO members (id, name) VALUES ('00000000-0000-0000-0000-00000000000a', 'yuto')`,
		`INSERT INTO groups (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'trip')`,
		`INSERT INTO group_members VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a')`,
		`INSERT INTO entries (id, group_id, kind, payer_id, total_amount, split_rule, participants, occurred_on, created_by)
		 VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'expense',
		         '00000000-0000-0000-0000-00000000000a', 1000, '{"type":"equal"}',
		         ARRAY['00000000-0000-0000-0000-00000000000a']::uuid[], '2026-07-05',
		         '00000000-0000-0000-0000-00000000000a')`,
	} {
		if _, err := s.Pool.Exec(ctx, q); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	// UPDATE and DELETE on the ledger must be rejected by the trigger.
	if _, err := s.Pool.Exec(ctx, `UPDATE entries SET memo = 'oops'`); err == nil {
		t.Fatal("UPDATE on entries should be forbidden")
	}
	if _, err := s.Pool.Exec(ctx, `DELETE FROM entries`); err == nil {
		t.Fatal("DELETE on entries should be forbidden")
	}
}

func TestTestStoreSkipsWithoutEnv(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("no TEST_DATABASE_URL; TestStore would skip too")
	}
}
