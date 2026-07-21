package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
)

func TestCheckIntegrity_CleanLedger(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	orig := uuid.New()
	addExpense(t, s, orig, rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})
	addExpense(t, s, uuid.New(), rMemA, 500, []uuid.UUID{rMemA, rMemB})
	if _, err := reverse(t, s, orig); err != nil {
		t.Fatal(err)
	}

	rep, err := s.CheckIntegrity(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !rep.OK() {
		t.Fatalf("clean ledger reported dirty: %+v", rep)
	}
}

// TestGetBalances_MatchesFullLedgerReplay is the acceptance-criteria
// property: GetBalances (the balances view, one MVCC snapshot) must always
// equal balances recomputed by folding every entry's postings from
// ListEntries (full replay). Exercises add + reverse + edit together.
func TestGetBalances_MatchesFullLedgerReplay(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)

	e1, e2 := uuid.New(), uuid.New()
	addExpense(t, s, e1, rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})
	addExpense(t, s, e2, rMemA, 3000, []uuid.UUID{rMemA, rMemB})
	if _, err := reverse(t, s, e1); err != nil {
		t.Fatal(err)
	}

	newID, revID, key := uuid.New(), uuid.New(), uuid.New()
	postings, err := ledger.ComputePostings(rMemB, 600, ledger.SplitRule{Type: ledger.SplitEqual}, []uuid.UUID{rMemB, rYuto})
	if err != nil {
		t.Fatal(err)
	}
	if res, _, err := s.Acquire(context.Background(), key, key.String()); err != nil || res != entry.GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	if _, err := s.Edit(context.Background(), key, rGroup, e2, revID, entry.Input{
		ID: newID, GroupID: rGroup, Kind: entry.KindExpense, PayerID: rMemB,
		TotalAmount: 600, SplitRule: []byte(`{"type":"equal"}`),
		Participants: []uuid.UUID{rMemB, rYuto},
		OccurredOn:   time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC), CreatedBy: rMemB,
	}, postings); err != nil {
		t.Fatal(err)
	}

	// Derived: the balances view via GetBalances.
	snap, err := s.GetBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}

	// Replayed: fold every entry's postings from full ledger history.
	entries, err := s.ListEntries(context.Background(), rGroup, 0, 500)
	if err != nil {
		t.Fatal(err)
	}
	folded := map[uuid.UUID]int64{rYuto: 0, rMemA: 0, rMemB: 0}
	for _, e := range entries {
		for _, p := range e.Postings {
			folded[p.MemberID] += p.Amount
		}
	}

	if len(snap.Balances) != len(folded) {
		t.Fatalf("snapshot has %d members, folded has %d", len(snap.Balances), len(folded))
	}
	for _, mb := range snap.Balances {
		if mb.Balance != folded[mb.MemberID] {
			t.Fatalf("member %s: view balance %d != folded balance %d", mb.MemberID, mb.Balance, folded[mb.MemberID])
		}
	}
}
