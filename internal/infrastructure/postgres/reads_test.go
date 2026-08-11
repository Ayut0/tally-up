package postgres

import (
	"context"
	"encoding/json"
	"fmt"
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

// addExpenseIn writes one equal-split expense in an arbitrary group — needed
// for tests seeding beyond the 3-person rGroup fixture (addExpense always
// writes into rGroup).
func addExpenseIn(t *testing.T, s *Store, groupID, id, payer uuid.UUID, total int64, participants []uuid.UUID) {
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
		ID: id, GroupID: groupID, Kind: entry.KindExpense, PayerID: payer,
		TotalAmount: total, SplitRule: []byte(`{"type":"equal"}`),
		Participants: participants, OccurredOn: time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC),
		CreatedBy: payer,
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
	want := []entry.PairwiseBalance{
		{DebtorID: rMemA, CreditorID: rYuto, Amount: 4000},
		{DebtorID: rMemB, CreditorID: rYuto, Amount: 4000},
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
	// Sorted by the pair's canonical (lower, higher) UUID order internally,
	// which for these fixtures is (Yuto,A) < (Yuto,B) < (A,B).
	want := []entry.PairwiseBalance{
		{DebtorID: rMemA, CreditorID: rYuto, Amount: 2000},
		{DebtorID: rMemB, CreditorID: rYuto, Amount: 2000},
		{DebtorID: rMemB, CreditorID: rMemA, Amount: 2000},
	}
	if !reflect.DeepEqual(pairs, want) {
		t.Fatalf("got %+v, want %+v", pairs, want)
	}
}

// TestGetPairwiseBalances_TenMemberGroup proves the read-model holds at a
// scale beyond the 3-person fixture: with more members there are more pairs,
// each independently derived, so nothing about the query should assume a
// small group. member[0] pays a big shared expense split across all ten,
// then member[1] pays a smaller side expense with two others — a group of
// pairs disjoint from the first, at the same time.
func TestGetPairwiseBalances_TenMemberGroup(t *testing.T) {
	s := TestStore(t)
	groupID := uuid.New()
	members := make([]uuid.UUID, 10)
	for i := range members {
		members[i] = uuid.New()
		seedMember(t, s, members[i], fmt.Sprintf("member%d", i))
	}
	seedGroupWithMembers(t, s, groupID, members...)

	// member[0] pays 90000 split equally among all 10: each of the other
	// nine owes member[0] 9000.
	addExpenseIn(t, s, groupID, uuid.New(), members[0], 90000, members)
	// member[1] pays 4500 for a side expense with member[2] and member[3]:
	// each owes member[1] 1500. Disjoint from member[0]'s pairs above.
	addExpenseIn(t, s, groupID, uuid.New(), members[1], 4500, []uuid.UUID{members[1], members[2], members[3]})

	pairs, err := s.Reads.GetPairwiseBalances(context.Background(), groupID)
	if err != nil {
		t.Fatal(err)
	}
	// 9 pairs from the first expense (member[0] vs everyone else) + 2 from
	// the second (member[1] vs member[2], member[1] vs member[3]) = 11.
	if len(pairs) != 11 {
		t.Fatalf("got %d pairs, want 11: %+v", len(pairs), pairs)
	}

	snap, err := s.Reads.GetBalances(context.Background(), groupID)
	if err != nil {
		t.Fatal(err)
	}
	assertPairwiseNetsToBalances(t, snap.Balances, pairs)
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

	assertPairwiseNetsToBalances(t, snap.Balances, pairs)
}

// assertPairwiseNetsToBalances checks invariant #10 (docs/architecture.md):
// for each member, the signed sum of every pairwise edge touching them
// (positive if they're owed, negative if they owe) must equal their net
// balance from the independently-computed balances view.
func assertPairwiseNetsToBalances(t *testing.T, balances []entry.MemberBalance, pairs []entry.PairwiseBalance) {
	t.Helper()
	for _, mb := range balances {
		var net int64
		for _, p := range pairs {
			switch mb.MemberID {
			case p.DebtorID:
				net -= p.Amount
			case p.CreditorID:
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

	all, _, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 0, 100)
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
	tail, _, err := s.Reads.ListEntries(context.Background(), rGroup, all[1].Seq, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(tail) != 1 || tail[0].ID != e3 {
		t.Fatalf("after_seq fetch wrong: %+v", tail)
	}
}

// TestListEntries_CreatedAtIsUTC guards #217: spec/main.tsp types created_at
// as utcDateTime, and the web client's generated zod schema enforces that
// strictly (UTC/"Z"-suffixed only). The Postgres driver hands scanned
// timestamptz values back located in whatever time.Local currently is, so
// forcing a non-UTC time.Local here reproduces the bug regardless of the
// host's own system timezone — notably including CI, which typically already
// runs in UTC and would otherwise mask this. Mutating the package-level
// time.Local is safe only because nothing in this file calls t.Parallel();
// don't add it to this test (or reintroduce it elsewhere in this file)
// without reworking this to avoid the shared global.
func TestListEntries_CreatedAtIsUTC(t *testing.T) {
	jst, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Skipf("Asia/Tokyo tzdata unavailable: %v", err)
	}
	orig := time.Local
	time.Local = jst
	t.Cleanup(func() { time.Local = orig })

	s := TestStore(t)
	seedReadGroup(t, s)
	addExpense(t, s, uuid.New(), rYuto, 1000, []uuid.UUID{rYuto, rMemA})

	entries, _, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(entries))
	}
	if loc := entries[0].CreatedAt.Location(); loc != time.UTC {
		t.Fatalf("CreatedAt.Location() = %v, want UTC (time.Local was forced to %v)", loc, jst)
	}
}

// TestListEntries_DefaultReturnsLatestEntries covers #221: with no cursor,
// ListEntries must return the *latest* `limit` entries (ascending order),
// not the oldest — the prior oldest-first default silently truncated any
// group past 100 entries, since nothing ever advanced past that page.
func TestListEntries_DefaultReturnsLatestEntries(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	e1, e2, e3 := uuid.New(), uuid.New(), uuid.New()
	addExpense(t, s, e1, rYuto, 100, []uuid.UUID{rYuto, rMemA})
	addExpense(t, s, e2, rYuto, 200, []uuid.UUID{rYuto, rMemA})
	addExpense(t, s, e3, rYuto, 300, []uuid.UUID{rYuto, rMemA})

	page, hasMore, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page) != 2 || page[0].ID != e2 || page[1].ID != e3 {
		t.Fatalf("got %+v, want latest 2 (e2, e3) ascending", page)
	}
	if !hasMore {
		t.Fatal("has_more = false, want true (e1 not yet loaded)")
	}
}

// TestListEntries_BeforeSeqPagesOlderHistory covers #221 "Load more": paging
// with before_seq set to the lowest seq already loaded returns the next
// strictly-older page, and reports has_more correctly at the exact boundary
// (remaining count == limit must not be mistaken for "more still exist").
func TestListEntries_BeforeSeqPagesOlderHistory(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	e1, e2, e3, e4 := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	addExpense(t, s, e1, rYuto, 100, []uuid.UUID{rYuto, rMemA})
	addExpense(t, s, e2, rYuto, 200, []uuid.UUID{rYuto, rMemA})
	addExpense(t, s, e3, rYuto, 300, []uuid.UUID{rYuto, rMemA})
	addExpense(t, s, e4, rYuto, 400, []uuid.UUID{rYuto, rMemA})

	page1, hasMore1, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page1) != 2 || page1[0].ID != e3 || page1[1].ID != e4 {
		t.Fatalf("page1 = %+v, want latest 2 (e3, e4) ascending", page1)
	}
	if !hasMore1 {
		t.Fatal("page1 has_more = false, want true (e1, e2 not yet loaded)")
	}

	page2, hasMore2, err := s.Reads.ListEntries(context.Background(), rGroup, 0, page1[0].Seq, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page2) != 2 || page2[0].ID != e1 || page2[1].ID != e2 {
		t.Fatalf("page2 = %+v, want older 2 (e1, e2) ascending", page2)
	}
	if hasMore2 {
		t.Fatal("page2 has_more = true, want false (exactly 2 remained, none older)")
	}
}

func TestListEntries_LimitClamped(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	addExpense(t, s, uuid.New(), rYuto, 300, []uuid.UUID{rYuto, rMemA})
	addExpense(t, s, uuid.New(), rYuto, 300, []uuid.UUID{rYuto, rMemA})
	addExpense(t, s, uuid.New(), rYuto, 300, []uuid.UUID{rYuto, rMemA})

	one, _, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(one) != 1 {
		t.Fatalf("limit 1 returned %d entries", len(one))
	}

	// limit=2 should return exactly 2, proving the limit logic respects sub-default limits.
	two, _, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(two) != 2 {
		t.Fatalf("limit 2 returned %d entries, want 2", len(two))
	}

	// limit=0 and limit=10000 don't error and return all available entries.
	// The exact clamp targets (100 and 500) are not verified here without seeding
	// 100+ and 500+ rows respectively.
	zero, _, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 0, 0)
	if err != nil {
		t.Fatalf("limit 0: %v", err)
	}
	if len(zero) != 3 {
		t.Fatalf("limit 0 returned %d entries, want 3 (all available)", len(zero))
	}

	large, _, err := s.Reads.ListEntries(context.Background(), rGroup, 0, 0, 10_000)
	if err != nil {
		t.Fatalf("limit 10000: %v", err)
	}
	if len(large) != 3 {
		t.Fatalf("limit 10000 returned %d entries, want 3 (all available)", len(large))
	}
}
