# Pairwise Balances + Member Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add true pairwise "who owes whom" balances (spec §1) and the ability to add/remove group members after creation (spec §2), per `docs/superpowers/specs/2026-07-06-group-membership-privacy-pairwise-design.md`.

**Architecture:** Pairwise balances are a pure derived read-model computed from the existing `entries`/`postings` tables — no schema change. Member add/remove extends the existing `group_members` join table with a create endpoint (idempotent, mirrors every other create in this system) and a delete endpoint (naturally idempotent, gated only by a zero-balance check).

**Tech Stack:** Same as prior plans — Go 1.23+, `pgx/v5`, stdlib ServeMux, `TEST_DATABASE_URL`-gated integration tests, `rapid` for property tests.

**Prerequisites:** All four prior plans are executed: `internal/ledger`, `internal/store` (with `Store`, `TestStore`, `GetBalances`, `AcquireIdempotencyKey`, `CreateGroup`/`GetGroup`), `internal/api` (with `NewServer`, `httpError`/`writeJSON`, `newTestServer`/`seedGroup`/`post` test helpers, `gID`/`yuto`/`memA`/`memB` fixtures).

## Global Constraints

- Money is integer yen in `int64`. No floats.
- Pairwise balances never list a zero-net pair — only nonzero relationships are returned (spec §1: "unlike the `balances` view... a zero relationship carries no information").
- Pairwise result convention: for a pair, the member with the lexicographically smaller UUID (byte order) is always `A`; `Amount > 0` means A owes B, `Amount < 0` means B owes A. Never exactly zero.
- Adding a member requires `Idempotency-Key` (same convention as every other create endpoint: 201/200-replay/409-in-flight/422-mismatch). Its ID is minted with `uuid.NewV7()` (no DB default — see the Phase 1-2 plan's Global Constraints).
- Removing a member requires **no** `Idempotency-Key` — deletes are naturally idempotent. Blocked with `409` unless the member's balance is exactly zero.
- Removing a member deletes only the `group_members` link, never the `members` row — historical `entries`/`postings` keep their FK and remain fully readable.
- No user registration/accounts anywhere in this plan — member names only, matching the existing identity model.
- Branch: `feat/issue-5-pairwise-member-management`.

## File Structure

```
internal/store/pairwise.go        — GetPairwiseBalances
internal/store/pairwise_test.go
internal/store/members.go         — AddMember, RemoveMember, ErrNonzeroBalance
internal/store/members_test.go
internal/api/pairwise.go          — GET /groups/{group_id}/pairwise-balances
internal/api/members.go           — POST/DELETE /groups/{group_id}/members[/{member_id}]
internal/api/members_test.go
internal/api/server.go            — modify: register 3 new routes
web/lib/api.ts                    — modify: getPairwiseBalances, addMember, removeMember
web/lib/types.ts                  — modify: PairwiseBalance type
web/app/g/[groupId]/owes/page.tsx — "who owes whom" screen
```

---

### Task 1: `GetPairwiseBalances` — derived pairwise read-model

**Files:**
- Create: `internal/store/pairwise.go`
- Test: `internal/store/pairwise_test.go`

**Interfaces:**
- Consumes: `TestStore`, `seedReadGroup`/`addExpense`/`addSettlement`/`rGroup`/`rYuto`/`rMemA`/`rMemB` (test helpers already defined in `internal/store/reads_test.go` and `internal/store/settle_test.go` — same package, no import needed), `GetBalances`.
- Produces:
  - `store.PairwiseBalance{A uuid.UUID; B uuid.UUID; Amount int64}` (JSON `a`, `b`, `amount`) — by convention `A`'s bytes `<` `B`'s bytes; `Amount` is never `0`.
  - `(*Store) GetPairwiseBalances(ctx context.Context, groupID uuid.UUID) ([]PairwiseBalance, error)` — sorted by `(A, B)` ascending for determinism.

- [ ] **Step 1: Write the failing tests**

`internal/store/pairwise_test.go`:

```go
package store

import (
	"context"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// Fixture UUIDs (rYuto=...a, rMemA=...b, rMemB=...c, from reads_test.go) sort
// rYuto < rMemA < rMemB in byte order, so GetPairwiseBalances' sorted output
// is fully deterministic — expectations below are hardcoded, not computed.

func TestGetPairwiseBalances_SinglePayerExpense(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	// Yuto pays 12000, 3-way equal: A owes Yuto 4000, B owes Yuto 4000.
	addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})

	pairs, err := s.GetPairwiseBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	// rYuto < rMemA < rMemB, so both pairs list Yuto as A; negative means
	// B owes A (memA/memB owe Yuto), per the documented sign convention.
	want := []PairwiseBalance{
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
	if err := addSettlement(t, s, rMemA, rYuto, 4000, nil); err != nil {
		t.Fatal(err)
	}

	pairs, err := s.GetPairwiseBalances(context.Background(), rGroup)
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
	pairs, err := s.GetPairwiseBalances(context.Background(), rGroup)
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
	e1 := uuid.New()
	postings, err := computeExactSplit(t, rYuto, 6000, map[uuid.UUID]int64{rYuto: 2000, rMemA: 2000, rMemB: 2000})
	if err != nil {
		t.Fatal(err)
	}
	addExpenseWithPostings(t, s, e1, rYuto, 6000, []uuid.UUID{rYuto, rMemA, rMemB}, `{"type":"exact"}`, postings)
	// A pays 4000 for taxi, split exactly A:2000, B:2000: B owes A 2000.
	e2 := uuid.New()
	postings2, err := computeExactSplit(t, rMemA, 4000, map[uuid.UUID]int64{rMemA: 2000, rMemB: 2000})
	if err != nil {
		t.Fatal(err)
	}
	addExpenseWithPostings(t, s, e2, rMemA, 4000, []uuid.UUID{rMemA, rMemB}, `{"type":"exact"}`, postings2)

	pairs, err := s.GetPairwiseBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	// Sorted by (A,B): (Yuto,A) < (Yuto,B) < (A,B), since rYuto < rMemA < rMemB.
	want := []PairwiseBalance{
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
	if err := addSettlement(t, s, rMemB, rYuto, 1000, nil); err != nil {
		t.Fatal(err)
	}

	snap, err := s.GetBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	pairs, err := s.GetPairwiseBalances(context.Background(), rGroup)
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
```

Add two small test helpers this file needs, appended to `internal/store/reads_test.go` (same package as the entry point for constructing arbitrary-split test expenses — `addExpense` only supports equal splits):

```go
// computeExactSplit builds the postings for an exact split without going
// through the HTTP layer, for tests that need non-equal splits.
func computeExactSplit(t *testing.T, payer uuid.UUID, total int64, amounts map[uuid.UUID]int64) ([]ledger.Posting, error) {
	t.Helper()
	participants := make([]uuid.UUID, 0, len(amounts))
	for m := range amounts {
		participants = append(participants, m)
	}
	return ledger.ComputePostings(payer, total, ledger.SplitRule{Type: ledger.SplitExact, Amounts: amounts}, participants)
}

// addExpenseWithPostings writes an expense with precomputed postings (for
// split rules addExpense's equal-only helper can't build).
func addExpenseWithPostings(t *testing.T, s *Store, id uuid.UUID, payer uuid.UUID, total int64, participants []uuid.UUID, splitRuleJSON string, postings []ledger.Posting) {
	t.Helper()
	key := uuid.New()
	if res, _, err := s.AcquireIdempotencyKey(context.Background(), key, key.String()); err != nil || res != GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	_, err := s.CreateEntry(context.Background(), key, EntryInput{
		ID: id, GroupID: rGroup, Kind: "expense", PayerID: payer,
		TotalAmount: total, SplitRule: []byte(splitRuleJSON),
		Participants: participants, OccurredOn: time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC),
		CreatedBy: payer,
	}, postings)
	if err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/store/ -v -run PairwiseBalances`
Expected: compile FAIL — `undefined: PairwiseBalance`, `s.GetPairwiseBalances undefined`.

- [ ] **Step 3: Implement**

`internal/store/pairwise.go`:

```go
package store

import (
	"bytes"
	"context"
	"sort"

	"github.com/google/uuid"
)

// PairwiseBalance is one nonzero debt relationship between two members.
// By convention A's bytes are lexicographically less than B's; Amount > 0
// means A owes B, Amount < 0 means B owes A. Zero pairs are never returned.
type PairwiseBalance struct {
	A      uuid.UUID `json:"a"`
	B      uuid.UUID `json:"b"`
	Amount int64     `json:"amount"`
}

// GetPairwiseBalances derives true per-pair debt from entries+postings —
// no new schema. Expense-shaped entries (counterparty IS NULL): each
// non-payer participant's posting is what they owe the payer. Settlement-
// shaped entries (counterparty IS NOT NULL): the payer's own posting is
// what discharges their debt to the counterparty. Both queries return
// signed contributions that get netted per unordered pair in Go.
func (s *Store) GetPairwiseBalances(ctx context.Context, groupID uuid.UUID) ([]PairwiseBalance, error) {
	type contribution struct {
		debtor, creditor uuid.UUID
		amount           int64 // positive: debtor owes creditor this much
	}
	var contributions []contribution

	expenseRows, err := s.Pool.Query(ctx, `
		SELECT p.member_id, e.payer_id, -p.amount
		FROM postings p JOIN entries e ON e.id = p.entry_id
		WHERE e.group_id = $1 AND e.counterparty IS NULL AND p.member_id != e.payer_id`,
		groupID)
	if err != nil {
		return nil, err
	}
	for expenseRows.Next() {
		var c contribution
		if err := expenseRows.Scan(&c.debtor, &c.creditor, &c.amount); err != nil {
			expenseRows.Close()
			return nil, err
		}
		contributions = append(contributions, c)
	}
	if err := expenseRows.Err(); err != nil {
		return nil, err
	}
	expenseRows.Close()

	settlementRows, err := s.Pool.Query(ctx, `
		SELECT e.payer_id, e.counterparty, -p.amount
		FROM postings p JOIN entries e ON e.id = p.entry_id
		WHERE e.group_id = $1 AND e.counterparty IS NOT NULL AND p.member_id = e.payer_id`,
		groupID)
	if err != nil {
		return nil, err
	}
	for settlementRows.Next() {
		var c contribution
		if err := settlementRows.Scan(&c.debtor, &c.creditor, &c.amount); err != nil {
			settlementRows.Close()
			return nil, err
		}
		contributions = append(contributions, c)
	}
	if err := settlementRows.Err(); err != nil {
		return nil, err
	}
	settlementRows.Close()

	type pairKey struct{ lo, hi uuid.UUID }
	net := map[pairKey]int64{}
	for _, c := range contributions {
		lo, hi, amt := c.debtor, c.creditor, c.amount
		if bytes.Compare(lo[:], hi[:]) > 0 {
			lo, hi = hi, lo
			amt = -amt // debtor becomes hi, so the "lo owes hi" sign flips
		}
		net[pairKey{lo, hi}] += amt
	}

	result := make([]PairwiseBalance, 0, len(net))
	for k, amt := range net {
		if amt == 0 {
			continue
		}
		result = append(result, PairwiseBalance{A: k.lo, B: k.hi, Amount: amt})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].A != result[j].A {
			return bytes.Compare(result[i].A[:], result[j].A[:]) < 0
		}
		return bytes.Compare(result[i].B[:], result[j].B[:]) < 0
	})
	return result, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/store/ -v -run PairwiseBalances`
Expected: PASS. Then: `go test ./internal/store/ -v -run Property` to confirm the cross-check property test passes alongside the existing ones.

- [ ] **Step 5: Commit**

```bash
git add internal/store/pairwise.go internal/store/pairwise_test.go internal/store/reads_test.go
git commit -m "feat: derive true pairwise who-owes-whom balances from the ledger"
```

---

### Task 2: `GET /groups/{group_id}/pairwise-balances`

**Files:**
- Create: `internal/api/pairwise.go`
- Modify: `internal/api/server.go`
- Test: append to `internal/api/reads_test.go` (same package; reuses `getJSON`, `newTestServer`, `post`, `expenseBody`, `gID`)

**Interfaces:**
- Consumes: `store.GetPairwiseBalances`, `store.PairwiseBalance`.
- Produces: route `GET /groups/{group_id}/pairwise-balances` → 200 + `{"balances":[{"a":…,"b":…,"amount":…}]}`.

- [ ] **Step 1: Write the failing test**

Append to `internal/api/reads_test.go`:

```go
func TestGetPairwiseBalances_Endpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New())) // yuto pays 12000, 3-way equal

	var body struct {
		Balances []struct {
			A      uuid.UUID `json:"a"`
			B      uuid.UUID `json:"b"`
			Amount int64     `json:"amount"`
		} `json:"balances"`
	}
	resp := getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/pairwise-balances", gID), &body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if len(body.Balances) != 2 {
		t.Fatalf("got %d pairs, want 2: %+v", len(body.Balances), body.Balances)
	}
	for _, p := range body.Balances {
		if p.Amount == 0 {
			t.Fatalf("zero-amount pair returned: %+v", p)
		}
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/api/ -v -run PairwiseBalances`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Implement**

`internal/api/pairwise.go`:

```go
package api

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
)

func (s *Server) handleGetPairwiseBalances(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	pairs, err := s.store.GetPairwiseBalances(r.Context(), groupID)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "pairwise balance read failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"balances": pairs})
}
```

In `internal/api/server.go`:

```go
	mux.HandleFunc("GET /groups/{group_id}/pairwise-balances", srv.handleGetPairwiseBalances)
```

- [ ] **Step 4: Run tests, commit**

Run: `go test ./internal/api/ -v`
Expected: PASS.

```bash
git add internal/api/pairwise.go internal/api/reads_test.go internal/api/server.go
git commit -m "feat: pairwise-balances endpoint"
```

---

### Task 3: `AddMember` + `POST /groups/{group_id}/members`

**Files:**
- Create: `internal/store/members.go`, `internal/api/members.go`
- Modify: `internal/api/server.go`
- Test: `internal/store/members_test.go`, `internal/api/members_test.go`

**Interfaces:**
- Consumes: `AcquireIdempotencyKey`/`ReleaseIdempotencyKey`, `store.GroupMember` (already defined in the client plan's group work: `{ID uuid.UUID; Name string}`).
- Produces:
  - `(*Store) AddMember(ctx context.Context, key uuid.UUID, groupID uuid.UUID, name string) ([]byte, error)` — one txn: insert `members` row, insert `group_members` link, mark key succeeded with the new `GroupMember` JSON as the response (`RETURNING response_body` for byte-identical replays, same pattern as `CreateEntry`).
  - Route: `POST /groups/{group_id}/members`, `Idempotency-Key` required, body `{"name":"..."}`, name trimmed 1–50 chars (same rule as `createGroupRequest`'s member names). 201/200-replay/409-in-flight/422 (validation or hash mismatch).

- [ ] **Step 1: Write the failing store test**

`internal/store/members_test.go`:

```go
package store

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestAddMember(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	key := uuid.New()
	if res, _, err := s.AcquireIdempotencyKey(context.Background(), key, key.String()); err != nil || res != GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}

	resp, err := s.AddMember(context.Background(), key, rGroup, "new friend")
	if err != nil {
		t.Fatal(err)
	}
	var added GroupMember
	if err := json.Unmarshal(resp, &added); err != nil {
		t.Fatalf("response %s: %v", resp, err)
	}
	if added.Name != "new friend" || added.ID == uuid.Nil {
		t.Fatalf("bad AddMember response: %+v", added)
	}

	grp, err := s.GetGroup(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, m := range grp.Members {
		if m.ID == added.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("new member not in group: %+v", grp.Members)
	}

	// The new member is immediately usable as an expense participant.
	if err := addExpenseWithNewMember(t, s, added.ID); err != nil {
		t.Fatalf("new member unusable in an expense: %v", err)
	}
}

// addExpenseWithNewMember exercises CreateEntry with the newly added member
// as a participant, proving group-membership validation sees them immediately.
func addExpenseWithNewMember(t *testing.T, s *Store, newMemberID uuid.UUID) error {
	t.Helper()
	postings, err := computeExactSplit(t, rYuto, 1000, map[uuid.UUID]int64{rYuto: 500, newMemberID: 500})
	if err != nil {
		return err
	}
	key := uuid.New()
	if res, _, err := s.AcquireIdempotencyKey(context.Background(), key, key.String()); err != nil || res != GateProceed {
		return err
	}
	_, err = s.CreateEntry(context.Background(), key, EntryInput{
		ID: uuid.New(), GroupID: rGroup, Kind: "expense", PayerID: rYuto,
		TotalAmount: 1000, SplitRule: []byte(`{"type":"exact"}`),
		Participants: []uuid.UUID{rYuto, newMemberID},
		OccurredOn:   time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC), CreatedBy: rYuto,
	}, postings)
	return err
}
```

This test reuses `computeExactSplit` from Task 1 — same package, no import needed, but sequence this task after Task 1 lands.

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/store/ -v -run AddMember`
Expected: compile FAIL — `s.AddMember undefined`.

- [ ] **Step 3: Implement**

`internal/store/members.go`:

```go
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrNonzeroBalance = errors.New("member has a nonzero balance; settle up before removing")

// AddMember inserts a new member and links them to the group in one txn,
// marking the idempotency key with the new GroupMember as the response.
func (s *Store) AddMember(ctx context.Context, key uuid.UUID, groupID uuid.UUID, name string) ([]byte, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// id columns have no DB default (see the Phase 1-2 plan's Global
	// Constraints) — every member ID is minted here as UUIDv7.
	mid, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("generate member id: %w", err)
	}
	member := GroupMember{ID: mid, Name: name}
	if _, err := tx.Exec(ctx,
		`INSERT INTO members (id, name) VALUES ($1, $2)`, member.ID, name); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO group_members (group_id, member_id) VALUES ($1, $2)`, groupID, member.ID); err != nil {
		return nil, err
	}

	snapshot, err := json.Marshal(member)
	if err != nil {
		return nil, fmt.Errorf("marshal member: %w", err)
	}
	var resp []byte
	if err := tx.QueryRow(ctx,
		`UPDATE idempotency_keys SET status='succeeded', response_body=$2 WHERE key=$1
		 RETURNING response_body`, key, snapshot).Scan(&resp); err != nil {
		return nil, err
	}
	return resp, tx.Commit(ctx)
}
```

- [ ] **Step 4: Run store tests**

Run: `go test ./internal/store/ -v -run AddMember`
Expected: PASS.

- [ ] **Step 5: API test, handler, route**

`internal/api/members_test.go`:

```go
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestAddMember_Endpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	body, _ := json.Marshal(map[string]string{"name": "new friend"})
	req, _ := http.NewRequest("POST", srv.URL+fmt.Sprintf("/groups/%s/members", gID), bytes.NewReader(body))
	req.Header.Set("Idempotency-Key", uuid.New().String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	rb, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s", resp.StatusCode, rb)
	}
	var added struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	}
	if err := json.Unmarshal(rb, &added); err != nil || added.Name != "new friend" {
		t.Fatalf("bad response %s: %v", rb, err)
	}
}

func TestAddMember_BlankNameRejected(t *testing.T) {
	srv, _ := newTestServer(t)
	body, _ := json.Marshal(map[string]string{"name": "   "})
	req, _ := http.NewRequest("POST", srv.URL+fmt.Sprintf("/groups/%s/members", gID), bytes.NewReader(body))
	req.Header.Set("Idempotency-Key", uuid.New().String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422", resp.StatusCode)
	}
}
```

`internal/api/members.go`:

```go
package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"tallyup/internal/store"
)

type addMemberRequest struct {
	Name string `json:"name"`
}

func (s *Server) handleAddMember(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	key, err := uuid.Parse(r.Header.Get("Idempotency-Key"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "Idempotency-Key header (UUID) required")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		httpError(w, http.StatusBadRequest, "unreadable body")
		return
	}
	sum := sha256.Sum256(body)
	requestHash := hex.EncodeToString(sum[:])

	var req addMemberRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 50 {
		httpError(w, http.StatusUnprocessableEntity, "name must be 1-50 characters")
		return
	}

	gate, stored, err := s.store.AcquireIdempotencyKey(r.Context(), key, requestHash)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "idempotency gate failed")
		return
	}
	switch gate {
	case store.GateReplay:
		writeJSON(w, http.StatusOK, stored)
		return
	case store.GateInFlight:
		httpError(w, http.StatusConflict, "request in flight; retry shortly")
		return
	case store.GateMismatch:
		httpError(w, http.StatusUnprocessableEntity, "idempotency key reused with different payload")
		return
	}

	resp, err := s.store.AddMember(r.Context(), key, groupID, req.Name)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "add member failed")
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}
```

In `internal/api/server.go`:

```go
	mux.HandleFunc("POST /groups/{group_id}/members", srv.handleAddMember)
```

- [ ] **Step 6: Run everything, commit**

Run: `go test ./... -race`
Expected: PASS.

```bash
git add internal/store/members.go internal/store/members_test.go internal/api/members.go internal/api/members_test.go internal/api/server.go
git commit -m "feat: add member to an existing group"
```

---

### Task 4: `RemoveMember` + `DELETE /groups/{group_id}/members/{member_id}`

**Files:**
- Modify: `internal/store/members.go`, `internal/api/members.go`, `internal/api/server.go`
- Test: append to `internal/store/members_test.go`, `internal/api/members_test.go`

**Interfaces:**
- Consumes: `GetBalances` (for the zero-balance check).
- Produces:
  - `(*Store) RemoveMember(ctx context.Context, groupID, memberID uuid.UUID) error` — checks the member's current balance via `GetBalances`; if nonzero, returns `ErrNonzeroBalance`; otherwise deletes the `group_members` row (never the `members` row). Succeeds silently (no error) if the member was already removed — deletes are idempotent by nature.
  - Route: `DELETE /groups/{group_id}/members/{member_id}` — **no** `Idempotency-Key`. 204 on success (including "already removed"), 409 if balance nonzero, 404 if the group doesn't exist.

- [ ] **Step 1: Write the failing store tests**

Append to `internal/store/members_test.go`:

```go
func TestRemoveMember_ZeroBalanceSucceeds(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	// rMemA never participates in anything — balance is zero by construction.
	if err := s.RemoveMember(context.Background(), rGroup, rMemA); err != nil {
		t.Fatal(err)
	}
	grp, err := s.GetGroup(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range grp.Members {
		if m.ID == rMemA {
			t.Fatalf("removed member still in group: %+v", grp.Members)
		}
	}
}

func TestRemoveMember_NonzeroBalanceRejected(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB}) // A now owes 4000
	if err := s.RemoveMember(context.Background(), rGroup, rMemA); !errors.Is(err, ErrNonzeroBalance) {
		t.Fatalf("got %v, want ErrNonzeroBalance", err)
	}
}

func TestRemoveMember_HistoryStaysReadable(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	entryID := uuid.New()
	addExpense(t, s, entryID, rYuto, 8000, []uuid.UUID{rYuto, rMemA}) // A owes 4000
	if err := addSettlement(t, s, rMemA, rYuto, 4000, nil); err != nil {
		t.Fatal(err) // A settles up, balance now zero
	}
	if err := s.RemoveMember(context.Background(), rGroup, rMemA); err != nil {
		t.Fatal(err)
	}
	entries, err := s.ListEntries(context.Background(), rGroup, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range entries {
		if e.ID == entryID {
			found = true
		}
	}
	if !found {
		t.Fatal("removed member's historical entry no longer readable")
	}
}

func TestRemoveMember_AlreadyRemovedIsNoop(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	if err := s.RemoveMember(context.Background(), rGroup, rMemA); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveMember(context.Background(), rGroup, rMemA); err != nil {
		t.Fatalf("second removal should be a no-op, got: %v", err)
	}
}
```

(Add `"errors"` to this test file's imports if not already present.)

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/store/ -v -run RemoveMember`
Expected: compile FAIL — `s.RemoveMember undefined`.

- [ ] **Step 3: Implement**

Append to `internal/store/members.go`:

```go
// RemoveMember unlinks a member from a group, blocked unless their balance
// is exactly zero. Only the group_members row is deleted — members and
// their historical entries/postings are untouched, so past history stays
// fully readable. Idempotent: removing an already-removed member is a no-op.
func (s *Store) RemoveMember(ctx context.Context, groupID, memberID uuid.UUID) error {
	snap, err := s.GetBalances(ctx, groupID)
	if err != nil {
		return err
	}
	for _, b := range snap.Balances {
		if b.MemberID == memberID && b.Balance != 0 {
			return ErrNonzeroBalance
		}
	}
	_, err = s.Pool.Exec(ctx,
		`DELETE FROM group_members WHERE group_id = $1 AND member_id = $2`, groupID, memberID)
	return err
}
```

- [ ] **Step 4: Run store tests**

Run: `go test ./internal/store/ -v -run RemoveMember`
Expected: PASS.

- [ ] **Step 5: API test, handler, route**

Append to `internal/api/members_test.go`:

```go
func TestRemoveMember_Endpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	req, _ := http.NewRequest("DELETE", srv.URL+fmt.Sprintf("/groups/%s/members/%s", gID, memA), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d, want 204", resp.StatusCode)
	}
}

func TestRemoveMember_NonzeroBalanceIs409(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New())) // memA now owes 4000

	req, _ := http.NewRequest("DELETE", srv.URL+fmt.Sprintf("/groups/%s/members/%s", gID, memA), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status %d, want 409", resp.StatusCode)
	}
}
```

Append to `internal/api/members.go`:

```go
func (s *Server) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	memberID, err := uuid.Parse(r.PathValue("member_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid member id")
		return
	}
	err = s.store.RemoveMember(r.Context(), groupID, memberID)
	switch {
	case errors.Is(err, store.ErrNonzeroBalance):
		httpError(w, http.StatusConflict, err.Error())
	case err != nil:
		httpError(w, http.StatusInternalServerError, "remove member failed")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
```

Add `"errors"` to `internal/api/members.go`'s imports. In `internal/api/server.go`:

```go
	mux.HandleFunc("DELETE /groups/{group_id}/members/{member_id}", srv.handleRemoveMember)
```

- [ ] **Step 6: Run everything, commit**

Run: `go test ./... -race`
Expected: PASS.

```bash
git add internal/store/members.go internal/store/members_test.go internal/api/members.go internal/api/members_test.go internal/api/server.go
git commit -m "feat: remove member from a group, blocked on nonzero balance"
```

---

### Task 5: Client — "who owes whom" screen + member management in group settings

**Files:**
- Modify: `web/lib/types.ts`, `web/lib/api.ts`
- Create: `web/app/g/[groupId]/owes/page.tsx`

**Interfaces:**
- Produces:
  - `types.ts`: `PairwiseBalance = { a: string; b: string; amount: number }`.
  - `api.ts`: `getPairwiseBalances(groupId) => Promise<{ balances: PairwiseBalance[] }>`; `addMember(groupId, name, key) => Promise<Member>` (wraps `postIdempotent`); `removeMember(groupId, memberId) => Promise<void>` (plain `fetch` DELETE, no idempotency key — mirrors the server contract).
  - `/g/[groupId]/owes` — fetches group + pairwise balances; renders one line per pair, oriented by sign: `Amount > 0` → "`nameOf(a)` owes `nameOf(b)` ¥`amount`", `Amount < 0` → "`nameOf(b)` owes `nameOf(a)` ¥`-amount`". Empty list → "Nobody owes anybody anything 🎉". Link back to the group home page, and a link from the group home page's Balances section to this screen (next to the existing "Settle up →" link added in the settle-up plan).

- [ ] **Step 1: Types + API client**

Add to `web/lib/types.ts`:

```ts
export type PairwiseBalance = { a: string; b: string; amount: number };
```

Add to `web/lib/api.ts`:

```ts
export const getPairwiseBalances = (groupId: string) =>
  getJSON<{ balances: PairwiseBalance[] }>(`/groups/${groupId}/pairwise-balances`);

export const addMember = (groupId: string, name: string, key: string) =>
  postIdempotent<Member>(`/groups/${groupId}/members`, { name }, key);

export async function removeMember(groupId: string, memberId: string): Promise<void> {
  const res = await fetch(apiUrl(`/groups/${groupId}/members/${memberId}`), { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "failed to remove member");
  }
}
```

(`Member` type already exists in `web/lib/types.ts` from the client plan.)

- [ ] **Step 2: "Who owes whom" screen**

`web/app/g/[groupId]/owes/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { getGroup, getPairwiseBalances } from "@/lib/api";
import type { Group, PairwiseBalance } from "@/lib/types";

export default function OwesPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = use(params);
  const [group, setGroup] = useState<Group | null>(null);
  const [pairs, setPairs] = useState<PairwiseBalance[] | null>(null);

  useEffect(() => {
    getGroup(groupId).then(setGroup).catch(() => {});
    getPairwiseBalances(groupId).then((r) => setPairs(r.balances)).catch(() => setPairs([]));
  }, [groupId]);

  if (!group || !pairs) return <main className="p-4 text-gray-500">Loading…</main>;
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-1 text-xl font-bold">Who owes whom</h1>
      <p className="mb-4 text-sm text-gray-500">{group.name}</p>

      {pairs.length === 0 ? (
        <p className="rounded-xl border p-6 text-center text-lg">Nobody owes anybody anything 🎉</p>
      ) : (
        <div className="flex flex-col gap-2">
          {pairs.map((p) => {
            const [debtor, creditor, amount] =
              p.amount > 0 ? [p.a, p.b, p.amount] : [p.b, p.a, -p.amount];
            return (
              <div key={`${p.a}:${p.b}`} className="rounded-xl border p-4">
                <strong>{nameOf(debtor)}</strong> owes <strong>{nameOf(creditor)}</strong>
                <span className="ml-2 text-lg">¥{amount.toLocaleString("ja-JP")}</span>
              </div>
            );
          })}
        </div>
      )}

      <Link href={`/g/${groupId}`} className="mt-6 block text-center text-sm text-blue-600">
        ← back to {group.name}
      </Link>
    </main>
  );
}
```

- [ ] **Step 3: Link it from the group home page**

In `web/app/g/[groupId]/page.tsx`, next to the existing "Settle up →" link (added by the settle-up plan) in the Balances section header, add:

```tsx
        <Link href={`/g/${groupId}/owes`} className="text-sm text-blue-600">Who owes whom →</Link>
```

- [ ] **Step 4: Hand verification**

With API + web dev server running: seed a group with the multi-payer scenario from Task 1's `TestGetPairwiseBalances_MultiPayerNets` (dinner paid by Yuto, taxi paid by A) via the add-expense form; open `/g/{groupId}/owes` and confirm it shows both true relationships (A owes Yuto, B owes Yuto, B owes A) — distinct from what the settle-up screen would propose.

Run: `cd web && npm test && npx tsc --noEmit && npm run build && cd .. && go test ./... -race`
Expected: everything PASS.

```bash
git add web/
git commit -m "feat: who-owes-whom screen"
```

---

## Deferred

- Member management UI (add/remove buttons in a "group settings" screen) beyond the read-only "who owes whom" view — this plan lands the API + one read screen; a full settings UI can follow.
- Group password protection — separate plan (`docs/superpowers/plans/2026-07-06-group-password.md`), per the spec's suggested phase split.
