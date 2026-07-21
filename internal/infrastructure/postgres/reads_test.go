package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
)

var (
	rGroup = uuid.MustParse("00000000-0000-0000-0000-0000000000a1")
	rYuto  = uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	rMemA  = uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	rMemB  = uuid.MustParse("00000000-0000-0000-0000-00000000000c")
)

// seedReadGroup inserts the 3-member fixture group (one statement per Exec).
func seedReadGroup(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	stmts := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO members (id, name) VALUES ($1,'yuto'), ($2,'a'), ($3,'b')`, []any{rYuto, rMemA, rMemB}},
		{`INSERT INTO groups (id, name) VALUES ($1,'trip')`, []any{rGroup}},
		{`INSERT INTO group_members (group_id, member_id) VALUES ($1,$2), ($1,$3), ($1,$4)`, []any{rGroup, rYuto, rMemA, rMemB}},
	}
	for _, st := range stmts {
		if _, err := s.Pool.Exec(ctx, st.sql, st.args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
}

// addExpense writes one equal-split expense through the real write path.
func addExpense(t *testing.T, s *Store, id uuid.UUID, payer uuid.UUID, total int64, participants []uuid.UUID) {
	t.Helper()
	postings, err := ledger.ComputePostings(payer, total, ledger.SplitRule{Type: ledger.SplitEqual}, participants)
	if err != nil {
		t.Fatal(err)
	}
	key := uuid.New()
	if res, _, err := s.Acquire(context.Background(), key, key.String()); err != nil || res != entry.GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	_, err = s.Create(context.Background(), key, entry.Input{
		ID: id, GroupID: rGroup, Kind: entry.KindExpense, PayerID: payer,
		TotalAmount: total, SplitRule: []byte(`{"type":"equal"}`),
		Participants: participants, OccurredOn: time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC),
		CreatedBy: payer,
	}, postings)
	if err != nil {
		t.Fatal(err)
	}
}

func TestGetBalances_AllMembersOneSnapshot(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	// Yuto pays 12000 split equally among all three: yuto +8000, a -4000, b -4000.
	addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})

	snap, err := s.GetBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	want := []entry.MemberBalance{{rYuto, 8000}, {rMemA, -4000}, {rMemB, -4000}}
	if len(snap.Balances) != 3 {
		t.Fatalf("got %d balances, want 3: %v", len(snap.Balances), snap.Balances)
	}
	for i, w := range want {
		if snap.Balances[i] != w {
			t.Fatalf("balance[%d] = %v, want %v", i, snap.Balances[i], w)
		}
	}
	if snap.AsOfSeq < 1 {
		t.Fatalf("as_of_seq = %d, want >= 1", snap.AsOfSeq)
	}
}

func TestGetBalances_EmptyLedgerZeroBalances(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	snap, err := s.GetBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Balances) != 3 {
		t.Fatalf("got %d balances, want 3 (zero-balance members included)", len(snap.Balances))
	}
	for _, b := range snap.Balances {
		if b.Balance != 0 {
			t.Fatalf("expected zero balance, got %v", b)
		}
	}
	if snap.AsOfSeq != 0 {
		t.Fatalf("as_of_seq = %d, want 0 on empty ledger", snap.AsOfSeq)
	}
}
