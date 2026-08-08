package postgres

import (
	"context"
	"encoding/json"
	"reflect"
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
	if res, _, err := s.Idempotency.Acquire(context.Background(), key, key.String()); err != nil || res != entry.GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	_, err = s.Entries.Create(context.Background(), key, entry.Input{
		ID: id, GroupID: rGroup, Kind: entry.KindExpense, PayerID: payer,
		TotalAmount: total, SplitRule: []byte(`{"type":"equal"}`),
		Participants: participants, OccurredOn: time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC),
		CreatedBy: payer,
	}, postings)
	if err != nil {
		t.Fatal(err)
	}
}

// addSettlement writes one settlement entry through the real write path.
func addSettlement(t *testing.T, s *Store, payer, counterparty uuid.UUID, amount int64) {
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
		ID: uuid.New(), GroupID: rGroup, Kind: entry.KindSettlement, PayerID: payer,
		Counterparty: &counterparty, TotalAmount: amount, SplitRule: []byte(`{"type":"settlement"}`),
		Participants: []uuid.UUID{payer, counterparty}, OccurredOn: time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC),
		CreatedBy: payer,
	}, postings)
	if err != nil {
		t.Fatal(err)
	}
}

// addExactExpense writes one exact-split expense — addExpense only covers
// equal splits.
func addExactExpense(t *testing.T, s *Store, id, payer uuid.UUID, total int64, amounts map[uuid.UUID]int64) {
	t.Helper()
	participants := make([]uuid.UUID, 0, len(amounts))
	for m := range amounts {
		participants = append(participants, m)
	}
	rule := ledger.SplitRule{Type: ledger.SplitExact, Amounts: amounts}
	postings, err := ledger.ComputePostings(payer, total, rule, participants)
	if err != nil {
		t.Fatal(err)
	}
	splitJSON, err := json.Marshal(rule)
	if err != nil {
		t.Fatal(err)
	}
	key := uuid.New()
	if res, _, err := s.Idempotency.Acquire(context.Background(), key, key.String()); err != nil || res != entry.GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	_, err = s.Entries.Create(context.Background(), key, entry.Input{
		ID: id, GroupID: rGroup, Kind: entry.KindExpense, PayerID: payer,
		TotalAmount: total, SplitRule: splitJSON, Participants: participants,
		OccurredOn: time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC), CreatedBy: payer,
	}, postings)
	if err != nil {
		t.Fatal(err)
	}
}

func TestGetPairwiseBalances_SinglePayerExpense(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	// Yuto pays 12000, 3-way equal: A owes Yuto 4000, B owes Yuto 4000.
	addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})

	pairs, err := s.Reads.GetPairwiseBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	// rYuto < rMemA < rMemB, so both pairs list Yuto as A; negative means
	// B owes A (memA/memB owe Yuto), per the documented sign convention.
	want := []entry.PairwiseBalance{
		{A: rYuto, B: rMemA, Amount: -4000},
		{A: rYuto, B: rMemB, Amount: -4000},
	}
	if !reflect.DeepEqual(pairs, want) {
		t.Fatalf("got %+v, want %+v", pairs, want)
	}
}

func TestGetPairwiseBalances_SettlementReducesDebt(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	addExpense(t, s, uuid.New(), rYuto, 8000, []uuid.UUID{rYuto, rMemA}) // A owes Yuto 4000
	addSettlement(t, s, rMemA, rYuto, 4000)

	pairs, err := s.Reads.GetPairwiseBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	if len(pairs) != 0 {
		t.Fatalf("expected debt fully settled (no pairs), got %+v", pairs)
	}
}

func TestGetPairwiseBalances_ZeroPairsOmitted(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	pairs, err := s.Reads.GetPairwiseBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	if len(pairs) != 0 {
		t.Fatalf("empty ledger should have no pairwise entries, got %+v", pairs)
	}
}

func TestGetPairwiseBalances_MultiPayerNets(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	// Yuto pays 6000, split exactly 2000/2000/2000 among Yuto, A, B:
	// A owes Yuto 2000, B owes Yuto 2000.
	addExactExpense(t, s, uuid.New(), rYuto, 6000, map[uuid.UUID]int64{rYuto: 2000, rMemA: 2000, rMemB: 2000})
	// A pays 4000 for taxi, split exactly A:2000, B:2000: B owes A 2000.
	addExactExpense(t, s, uuid.New(), rMemA, 4000, map[uuid.UUID]int64{rMemA: 2000, rMemB: 2000})

	pairs, err := s.Reads.GetPairwiseBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	// Sorted by (A,B): (Yuto,A) < (Yuto,B) < (A,B), since rYuto < rMemA < rMemB.
	want := []entry.PairwiseBalance{
		{A: rYuto, B: rMemA, Amount: -2000},
		{A: rYuto, B: rMemB, Amount: -2000},
		{A: rMemA, B: rMemB, Amount: -2000}, // B owes A
	}
	if !reflect.DeepEqual(pairs, want) {
		t.Fatalf("got %+v, want %+v", pairs, want)
	}
}

func TestProperty_PairwiseNetsToMemberBalance(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})
	addExpense(t, s, uuid.New(), rMemA, 3000, []uuid.UUID{rMemA, rMemB})
	addSettlement(t, s, rMemB, rYuto, 1000)

	snap, err := s.Reads.GetBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	pairs, err := s.Reads.GetPairwiseBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}

	// For each member, the signed sum of every pairwise edge touching them
	// (positive if they're the one owed, negative if they owe) must equal
	// their net balance from the independently-computed balances view.
	for _, mb := range snap.Balances {
		var net int64
		for _, p := range pairs {
			switch mb.MemberID {
			case p.A:
				net -= p.Amount // A owes B `Amount`, so A's net position drops by it
			case p.B:
				net += p.Amount
			}
		}
		if net != mb.Balance {
			t.Fatalf("member %s: pairwise sum %d != balance %d", mb.MemberID, net, mb.Balance)
		}
	}
}

func TestGetBalances_AllMembersOneSnapshot(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	// Yuto pays 12000 split equally among all three: yuto +8000, a -4000, b -4000.
	addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})

	snap, err := s.Reads.GetBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	want := []entry.MemberBalance{{MemberID: rYuto, Balance: 8000}, {MemberID: rMemA, Balance: -4000}, {MemberID: rMemB, Balance: -4000}}
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
	snap, err := s.Reads.GetBalances(context.Background(), rGroup)
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

func TestListEntries_AfterSeqIncremental(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	e1, e2, e3 := uuid.New(), uuid.New(), uuid.New()
	addExpense(t, s, e1, rYuto, 3000, []uuid.UUID{rYuto, rMemA, rMemB})
	addExpense(t, s, e2, rMemA, 2000, []uuid.UUID{rMemA, rMemB})
	addExpense(t, s, e3, rMemB, 900, []uuid.UUID{rYuto, rMemA, rMemB})

	all, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("got %d entries, want 3", len(all))
	}
	if all[0].ID != e1 || all[1].ID != e2 || all[2].ID != e3 {
		t.Fatalf("wrong order: %v %v %v", all[0].ID, all[1].ID, all[2].ID)
	}
	if all[0].Seq >= all[1].Seq || all[1].Seq >= all[2].Seq {
		t.Fatalf("seq not ascending: %d %d %d", all[0].Seq, all[1].Seq, all[2].Seq)
	}
	if len(all[1].Postings) != 2 {
		t.Fatalf("entry 2 has %d postings, want 2", len(all[1].Postings))
	}
	if all[0].OccurredOn != "2026-07-05" {
		t.Fatalf("occurred_on = %q, want 2026-07-05", all[0].OccurredOn)
	}

	// Incremental fetch: only entries after e2's seq.
	tail, err := s.Reads.ListEntries(context.Background(), rGroup, all[1].Seq, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(tail) != 1 || tail[0].ID != e3 {
		t.Fatalf("after_seq fetch wrong: %+v", tail)
	}
}

func TestListEntries_LimitClamped(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	addExpense(t, s, uuid.New(), rYuto, 300, []uuid.UUID{rYuto, rMemA})
	addExpense(t, s, uuid.New(), rYuto, 300, []uuid.UUID{rYuto, rMemA})
	addExpense(t, s, uuid.New(), rYuto, 300, []uuid.UUID{rYuto, rMemA})

	one, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(one) != 1 {
		t.Fatalf("limit 1 returned %d entries", len(one))
	}

	// limit=2 should return exactly 2, proving the limit logic respects sub-default limits.
	two, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(two) != 2 {
		t.Fatalf("limit 2 returned %d entries, want 2", len(two))
	}

	// limit=0 and limit=10000 don't error and return all available entries.
	// The exact clamp targets (100 and 500) are not verified here without seeding
	// 100+ and 500+ rows respectively.
	zero, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 0)
	if err != nil {
		t.Fatalf("limit 0: %v", err)
	}
	if len(zero) != 3 {
		t.Fatalf("limit 0 returned %d entries, want 3 (all available)", len(zero))
	}

	large, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 10_000)
	if err != nil {
		t.Fatalf("limit 10000: %v", err)
	}
	if len(large) != 3 {
		t.Fatalf("limit 10000 returned %d entries, want 3 (all available)", len(large))
	}
}
