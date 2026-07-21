package postgres

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
)

// reverse acquires a fresh idempotency key and calls Reverse.
func reverse(t *testing.T, s *Store, originalID uuid.UUID) ([]byte, error) {
	t.Helper()
	key := uuid.New()
	if res, _, err := s.Acquire(context.Background(), key, key.String()); err != nil || res != entry.GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	return s.Reverse(context.Background(), key, rGroup, originalID, uuid.New(), rYuto)
}

func TestReverse_NegatesAndZeroes(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	orig := uuid.New()
	addExpense(t, s, orig, rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})

	if _, err := reverse(t, s, orig); err != nil {
		t.Fatal(err)
	}

	// The reversal cancels the original: every balance returns to zero.
	snap, err := s.GetBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range snap.Balances {
		if b.Balance != 0 {
			t.Fatalf("balance not zeroed after reversal: %+v", snap.Balances)
		}
	}

	// The reversal entry references the original and copies its occurred_on.
	entries, err := s.ListEntries(context.Background(), rGroup, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	rev := entries[len(entries)-1]
	if rev.Kind != entry.KindReversal || rev.ReversesID == nil || *rev.ReversesID != orig {
		t.Fatalf("bad reversal record: %+v", rev)
	}
	if rev.OccurredOn != entries[0].OccurredOn {
		t.Fatalf("reversal occurred_on %q != original %q", rev.OccurredOn, entries[0].OccurredOn)
	}
}

func TestReverse_SecondReversalRejected(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	orig := uuid.New()
	addExpense(t, s, orig, rYuto, 3000, []uuid.UUID{rYuto, rMemA})

	if _, err := reverse(t, s, orig); err != nil {
		t.Fatal(err)
	}
	if _, err := reverse(t, s, orig); !errors.Is(err, entry.ErrAlreadyReversed) {
		t.Fatalf("got %v, want ErrAlreadyReversed", err)
	}
}

func TestReverse_ReversalNotReversible(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	orig := uuid.New()
	addExpense(t, s, orig, rYuto, 3000, []uuid.UUID{rYuto, rMemA})
	if _, err := reverse(t, s, orig); err != nil {
		t.Fatal(err)
	}
	entries, _ := s.ListEntries(context.Background(), rGroup, 0, 100)
	revID := entries[len(entries)-1].ID
	if _, err := reverse(t, s, revID); !errors.Is(err, entry.ErrNotReversible) {
		t.Fatalf("got %v, want ErrNotReversible", err)
	}
}

func TestReverse_UnknownEntry(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	if _, err := reverse(t, s, uuid.New()); !errors.Is(err, entry.ErrNotFound) {
		t.Fatalf("got %v, want ErrNotFound", err)
	}
}

func TestReverse_ConcurrentDoubleReversal_ExactlyOneWins(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	orig := uuid.New()
	addExpense(t, s, orig, rYuto, 9000, []uuid.UUID{rYuto, rMemA, rMemB})

	const workers = 10
	var wg sync.WaitGroup
	errs := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			key, revID := uuid.New(), uuid.New()
			if res, _, err := s.Acquire(context.Background(), key, key.String()); err != nil || res != entry.GateProceed {
				errs <- err
				return
			}
			_, err := s.Reverse(context.Background(), key, rGroup, orig, revID, rYuto)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)

	var ok, alreadyReversed int
	for err := range errs {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, entry.ErrAlreadyReversed):
			alreadyReversed++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if ok != 1 || alreadyReversed != workers-1 {
		t.Fatalf("ok=%d alreadyReversed=%d, want 1/%d", ok, alreadyReversed, workers-1)
	}

	var n int
	s.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM entries WHERE reverses_id = $1`, orig).Scan(&n)
	if n != 1 {
		t.Fatalf("%d reversal entries exist, want exactly 1", n)
	}
}

func TestEdit_ReverseAndReplaceAtomically(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	orig := uuid.New()
	// Original: yuto pays 12000, 3-way equal → yuto +8000, a -4000, b -4000.
	addExpense(t, s, orig, rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})

	// Edit: actually it was 9000, and only yuto and a shared it.
	newID, revID, key := uuid.New(), uuid.New(), uuid.New()
	postings, err := ledger.ComputePostings(rYuto, 9000,
		ledger.SplitRule{Type: ledger.SplitEqual}, []uuid.UUID{rYuto, rMemA})
	if err != nil {
		t.Fatal(err)
	}
	if res, _, err := s.Acquire(context.Background(), key, key.String()); err != nil || res != entry.GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	if _, err := s.Edit(context.Background(), key, rGroup, orig, revID, entry.Input{
		ID: newID, GroupID: rGroup, Kind: entry.KindExpense, PayerID: rYuto,
		TotalAmount: 9000, SplitRule: []byte(`{"type":"equal"}`),
		Participants: []uuid.UUID{rYuto, rMemA},
		OccurredOn:   time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC), CreatedBy: rYuto,
	}, postings); err != nil {
		t.Fatal(err)
	}

	// Net effect: only the corrected entry counts. yuto +4500, a -4500, b 0.
	snap, err := s.GetBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	want := []entry.MemberBalance{{MemberID: rYuto, Balance: 4500}, {MemberID: rMemA, Balance: -4500}, {MemberID: rMemB, Balance: 0}}
	for i, w := range want {
		if snap.Balances[i] != w {
			t.Fatalf("balance[%d] = %v, want %v", i, snap.Balances[i], w)
		}
	}

	// Ledger shape: original + reversal + replacement = 3 entries.
	entries, _ := s.ListEntries(context.Background(), rGroup, 0, 100)
	if len(entries) != 3 {
		t.Fatalf("%d entries, want 3", len(entries))
	}

	// The original cannot be edited twice.
	key2 := uuid.New()
	if res, _, err := s.Acquire(context.Background(), key2, key2.String()); err != nil || res != entry.GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	_, err = s.Edit(context.Background(), key2, rGroup, orig, uuid.New(), entry.Input{
		ID: uuid.New(), GroupID: rGroup, Kind: entry.KindExpense, PayerID: rYuto,
		TotalAmount: 100, SplitRule: []byte(`{"type":"equal"}`),
		Participants: []uuid.UUID{rYuto},
		OccurredOn:   time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC), CreatedBy: rYuto,
	}, []ledger.Posting{})
	if !errors.Is(err, entry.ErrAlreadyReversed) {
		t.Fatalf("second edit: got %v, want ErrAlreadyReversed", err)
	}
}
