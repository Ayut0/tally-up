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

// addSettlement records "payer paid counterparty amount" through the real
// write path, optionally under a plan_seq precondition. planSeq nil is the
// manual/off-plan settlement that skips the staleness check entirely.
func addSettlement(t *testing.T, s *Store, id, payer, counterparty uuid.UUID, amount int64, planSeq *int64) error {
	t.Helper()
	postings, err := ledger.SettlementPostings(payer, counterparty, amount)
	if err != nil {
		t.Fatal(err)
	}
	key := uuid.New()
	if res, _, err := s.Idempotency.Acquire(context.Background(), key, key.String()); err != nil || res != entry.GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	_, err = s.Entries.Create(context.Background(), key, entry.Input{
		ID: id, GroupID: rGroup, Kind: entry.KindSettlement, PayerID: payer,
		Counterparty: &counterparty, TotalAmount: amount,
		SplitRule:    []byte(`{"type":"settlement"}`),
		Participants: []uuid.UUID{payer, counterparty},
		OccurredOn:   time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC),
		CreatedBy:    payer, PlanSeq: planSeq,
	}, postings)
	return err
}

// currentSeq is the group's max entry seq — what a settle plan's as_of_seq
// carries and what the staleness check compares against.
func currentSeq(t *testing.T, s *Store) int64 {
	t.Helper()
	snap, err := s.Reads.GetBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	return snap.AsOfSeq
}

func TestCreate_PlanSeqMatching_AcceptedAndPersisted(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})

	seq := currentSeq(t, s)
	id := uuid.New()
	if err := addSettlement(t, s, id, rMemA, rYuto, 4000, &seq); err != nil {
		t.Fatalf("matching plan_seq rejected: %v", err)
	}

	var stored *int64
	if err := s.Pool.QueryRow(context.Background(),
		`SELECT plan_seq FROM entries WHERE id = $1`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == nil || *stored != seq {
		t.Fatalf("plan_seq persisted as %v, want %d", stored, seq)
	}
}

func TestCreate_PlanSeqStale_RejectedAndNothingWritten(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})

	stale := currentSeq(t, s)
	// Someone else's expense lands between propose and record.
	addExpense(t, s, uuid.New(), rMemB, 3000, []uuid.UUID{rYuto, rMemA, rMemB})
	moved := currentSeq(t, s)

	id := uuid.New()
	err := addSettlement(t, s, id, rMemA, rYuto, 4000, &stale)

	var staleErr *entry.PlanStaleError
	if !errors.As(err, &staleErr) {
		t.Fatalf("got %v, want PlanStaleError", err)
	}
	if staleErr.CurrentSeq != moved {
		t.Fatalf("CurrentSeq = %d, want %d", staleErr.CurrentSeq, moved)
	}

	var n int
	if err := s.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM entries WHERE id = $1`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("%d rows written for a rejected settlement, want 0", n)
	}
}

func TestCreate_NoPlanSeq_AlwaysAccepted(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})
	// Move the ledger; a manual settlement must not care.
	addExpense(t, s, uuid.New(), rMemB, 3000, []uuid.UUID{rYuto, rMemA, rMemB})

	id := uuid.New()
	if err := addSettlement(t, s, id, rMemA, rYuto, 4000, nil); err != nil {
		t.Fatalf("manual settlement rejected: %v", err)
	}

	var stored *int64
	if err := s.Pool.QueryRow(context.Background(),
		`SELECT plan_seq FROM entries WHERE id = $1`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != nil {
		t.Fatalf("plan_seq = %d, want NULL for an off-plan settlement", *stored)
	}
}

// TestCreate_PlanSeqConcurrent is the reason the group-row lock exists. Under
// READ COMMITTED without it, every worker would read the same MAX(seq),
// neither seeing the others' uncommitted inserts, and all would pass the
// check — silently applying N transfers against a plan that authorized one.
func TestCreate_PlanSeqConcurrent_ExactlyOneWins(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})
	seq := currentSeq(t, s)

	const workers = 10
	var wg sync.WaitGroup
	results := make(chan error, workers)
	for range workers {
		wg.Go(func() {
			results <- addSettlement(t, s, uuid.New(), rMemA, rYuto, 100, &seq)
		})
	}
	wg.Wait()
	close(results)

	var wins, stales int
	for err := range results {
		var staleErr *entry.PlanStaleError
		switch {
		case err == nil:
			wins++
		case errors.As(err, &staleErr):
			stales++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if wins != 1 || stales != workers-1 {
		t.Fatalf("got %d wins / %d stale, want 1 / %d", wins, stales, workers-1)
	}
}

// TestCreate_ExpenseNotBlockedBySettlementLock pins issue #122 decision 3:
// expense adds keep commuting even while a plan-checked settlement holds the
// group row.
//
// This is why that lock is FOR NO KEY UPDATE rather than the FOR UPDATE the
// issue sketched. entries.group_id references groups(id), so every entry
// insert takes FOR KEY SHARE on the group row to validate the foreign key —
// and FOR KEY SHARE conflicts with FOR UPDATE. A FOR UPDATE lock would
// therefore serialize *all* writes to the group, expenses included. FOR NO
// KEY UPDATE conflicts with itself (so settlements still serialize, which is
// the point) but not with FOR KEY SHARE.
func TestCreate_ExpenseNotBlockedBySettlementLock(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)

	ctx := context.Background()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Exactly the lock a plan-checked settlement holds for its transaction.
	if _, err := tx.Exec(ctx, `SELECT id FROM groups WHERE id = $1 FOR NO KEY UPDATE`, rGroup); err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("expense write blocked on the group row lock; it must stay lock-free")
	}
}
