package postgres

import (
	"context"
	"fmt"
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

// String keeps this file's failure messages readable ("want skip, got fail"
// rather than "want 1, got 2"). It lives here, not in store.go, because only
// these tests need it — unlike decideDBURL, which TestStore itself calls and
// so must be declared in a non-test file.
func (d dbURLDecision) String() string {
	switch d {
	case dbProceed:
		return "proceed"
	case dbSkip:
		return "skip"
	case dbFail:
		return "fail"
	}
	return fmt.Sprintf("dbURLDecision(%d)", int(d))
}

// TestDecideDBURL pins the opt-in fail-closed rule: a missing database skips by
// default, but fails wherever TALLYUP_REQUIRE_DB says DB coverage is expected.
// Somewhere that believes it exercises the database but silently doesn't would
// otherwise report green while asserting nothing.
//
// These cases are pure — no database, no env mutation — so they run anywhere.
func TestDecideDBURL(t *testing.T) {
	const url = "postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable"

	tests := []struct {
		name      string
		url       string
		requireDB string
		want      dbURLDecision
	}{
		{"url set, not required", url, "", dbProceed},
		{"url set, required", url, "1", dbProceed},
		{"no url, required=1", "", "1", dbFail},
		{"no url, required=true", "", "true", dbFail},
		{"no url, not required", "", "", dbSkip},

		// Turning the demand off by value must work as well as by absence,
		// so a wrapper script can pass the var through unconditionally.
		{"no url, required=false", "", "false", dbSkip},
		{"no url, required=0", "", "0", dbSkip},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := decideDBURL(tt.url, tt.requireDB); got != tt.want {
				t.Errorf("decideDBURL(%q, %q) = %v, want %v", tt.url, tt.requireDB, got, tt.want)
			}
		})
	}
}
