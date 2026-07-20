# tally-up — Reads + Reversals Implementation Plan (Phases 3–4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the read side (balances with snapshot seq, `after_seq` ledger history) and the correction side (reverse and edit as appending entries, with a row lock preventing double-reversal), plus the ledger integrity checks from `docs/architecture.md` §5.

**Architecture:** Reads are pure derivations — the balance endpoint reads the `balances` view in a single statement (one MVCC snapshot) and reports the `seq` it is consistent as of. Reversals append a `kind='reversal'` entry with negated postings; `SELECT … FOR UPDATE` on the original entry serializes concurrent reversal attempts (locking a row does not fire the append-only trigger — only actual UPDATE/DELETE do). Edit = reversal + new entry in one transaction.

**Tech Stack:** Same as the Phase 1–2 plan: Go 1.23+, stdlib ServeMux, `pgx/v5`, Postgres via docker compose, `TEST_DATABASE_URL`-gated integration tests.

**Prerequisite:** The Phase 1–2 plan (`2026-07-05-ledger-core-write-path.md`) is fully executed: `internal/domain/ledger`, `internal/infrastructure/postgres` (with `TestStore`, `AcquireIdempotencyKey`, `ReleaseIdempotencyKey`, `CreateEntry`), `internal/interfaces/rest` (with `NewServer`, `seedGroup`, `post`, `expenseBody`, `newTestServer` test helpers) all exist and pass.

## Global Constraints

- Money is integer yen in `int64`. No floats.
- `entries`/`postings` are append-only; corrections only ever append. `FOR UPDATE` row locks are allowed (no trigger fires); UPDATE/DELETE are not.
- A non-reversal entry is reversed **at most once** (architecture invariant 5); reversal entries themselves cannot be reversed.
- A reversal's postings are the exact negation of the original's; its `occurred_on` copies the original's (it corrects that day's record).
- Every write endpoint requires an `Idempotency-Key` header and follows the Phase 1–2 gate contract: 201 first success / 200 byte-identical replay / 409 in-flight / 422 hash mismatch; pending keys are released on post-gate failure.
- Balance responses include `as_of_seq` — the max entry `seq` the balances reflect — read in the **same SQL statement** as the balances so both come from one MVCC snapshot. This field is the snapshot hook the Phase 6 settle-up plan builds on.
- History (`ListEntries`) needs no transaction: entries and postings are immutable once visible.
- Branch: `feat/issue-5-reads-and-reversals`, created from the completed Phase 1–2 branch (or main after its merge).

## File Structure

```
internal/infrastructure/postgres/reads.go         — GetBalances, ListEntries + record types
internal/infrastructure/postgres/reads_test.go
internal/infrastructure/postgres/reversals.go     — ReverseEntry, EditEntry + sentinel errors
internal/infrastructure/postgres/reversals_test.go
internal/infrastructure/postgres/integrity.go     — CheckIntegrity + IntegrityReport
internal/infrastructure/postgres/integrity_test.go
internal/interfaces/rest/reads.go           — GET balance, GET entries handlers
internal/interfaces/rest/reversals.go       — POST reverse, PUT edit handlers
internal/interfaces/rest/reads_test.go
internal/interfaces/rest/reversals_test.go
internal/interfaces/rest/server.go          — modify: register the four new routes
```

---

### Task 1: Balance snapshot — `GetBalances` + `GET /groups/{group_id}/balance`

**Files:**
- Create: `internal/infrastructure/postgres/reads.go`, `internal/interfaces/rest/reads.go`
- Modify: `internal/interfaces/rest/server.go` (add route)
- Test: `internal/infrastructure/postgres/reads_test.go`, `internal/interfaces/rest/reads_test.go`

**Interfaces:**
- Consumes: `balances` view, `TestStore`, api test helpers (`newTestServer`, `seedGroup`, `post`, `expenseBody`, fixture IDs `gID`/`yuto`/`memA`/`memB`).
- Produces:
  - `store.MemberBalance{MemberID uuid.UUID; Balance int64}` (JSON `member_id`, `balance`)
  - `store.BalanceSnapshot{Balances []MemberBalance; AsOfSeq int64}` (JSON `balances`, `as_of_seq`)
  - `(*Store) GetBalances(ctx context.Context, groupID uuid.UUID) (BalanceSnapshot, error)` — every group member appears (zero balances included), ordered by member UUID bytes ascending.
  - Route `GET /groups/{group_id}/balance` → 200 + `BalanceSnapshot` JSON.

- [ ] **Step 1: Write the failing store test**

`internal/infrastructure/postgres/reads_test.go`:

```go
package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

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
	if res, _, err := s.AcquireIdempotencyKey(context.Background(), key, key.String()); err != nil || res != GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	_, err = s.CreateEntry(context.Background(), key, EntryInput{
		ID: id, GroupID: rGroup, Kind: "expense", PayerID: payer,
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
	// Yuto pays 12000 split equally among all three: yuto +8000, a −4000, b −4000.
	addExpense(t, s, uuid.New(), rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})

	snap, err := s.GetBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	want := []MemberBalance{{rYuto, 8000}, {rMemA, -4000}, {rMemB, -4000}}
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
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/infrastructure/postgres/ -v -run GetBalances`
Expected: compile FAIL — `undefined: MemberBalance`, `s.GetBalances undefined`.

- [ ] **Step 3: Implement the store read**

`internal/infrastructure/postgres/reads.go`:

```go
package store

import (
	"context"

	"github.com/google/uuid"
)

type MemberBalance struct {
	MemberID uuid.UUID `json:"member_id"`
	Balance  int64     `json:"balance"`
}

type BalanceSnapshot struct {
	Balances []MemberBalance `json:"balances"`
	AsOfSeq  int64           `json:"as_of_seq"`
}

// GetBalances returns every group member's net position plus the max entry
// seq those balances reflect. Both come from ONE statement, hence one MVCC
// snapshot — as_of_seq is exactly the ledger state the balances derive from.
func (s *Store) GetBalances(ctx context.Context, groupID uuid.UUID) (BalanceSnapshot, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT gm.member_id,
		       COALESCE(b.balance, 0),
		       (SELECT COALESCE(MAX(seq), 0) FROM entries e WHERE e.group_id = $1)
		FROM group_members gm
		LEFT JOIN balances b ON b.group_id = gm.group_id AND b.member_id = gm.member_id
		WHERE gm.group_id = $1
		ORDER BY gm.member_id`, groupID)
	if err != nil {
		return BalanceSnapshot{}, err
	}
	defer rows.Close()

	snap := BalanceSnapshot{Balances: []MemberBalance{}}
	for rows.Next() {
		var mb MemberBalance
		if err := rows.Scan(&mb.MemberID, &mb.Balance, &snap.AsOfSeq); err != nil {
			return BalanceSnapshot{}, err
		}
		snap.Balances = append(snap.Balances, mb)
	}
	return snap, rows.Err()
}
```

- [ ] **Step 4: Run store tests**

Run: `go test ./internal/infrastructure/postgres/ -v -run GetBalances`
Expected: PASS.

- [ ] **Step 5: Write the failing handler test**

`internal/interfaces/rest/reads_test.go`:

```go
package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func getJSON(t *testing.T, url string, out any) *http.Response {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(body, out); err != nil {
		t.Fatalf("unmarshal %s: %v", body, err)
	}
	return resp
}

func TestGetBalance_Endpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New())) // yuto pays 12000 / 3-way

	var snap struct {
		Balances []struct {
			MemberID uuid.UUID `json:"member_id"`
			Balance  int64     `json:"balance"`
		} `json:"balances"`
		AsOfSeq int64 `json:"as_of_seq"`
	}
	resp := getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/balance", gID), &snap)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if len(snap.Balances) != 3 || snap.Balances[0].Balance != 8000 {
		t.Fatalf("unexpected snapshot: %+v", snap)
	}
	if snap.AsOfSeq < 1 {
		t.Fatalf("as_of_seq = %d, want >= 1", snap.AsOfSeq)
	}
}
```

- [ ] **Step 6: Implement the handler and route**

`internal/interfaces/rest/reads.go`:

```go
package api

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
)

func (s *Server) handleGetBalance(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	snap, err := s.store.GetBalances(r.Context(), groupID)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "balance read failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(snap)
}
```

In `internal/interfaces/rest/server.go`, add to `NewServer`:

```go
	mux.HandleFunc("GET /groups/{group_id}/balance", srv.handleGetBalance)
```

- [ ] **Step 7: Run all tests, then commit**

Run: `go test ./internal/infrastructure/postgres/ ./internal/interfaces/rest/ -v`
Expected: PASS.

```bash
git add internal/infrastructure/postgres/reads.go internal/infrastructure/postgres/reads_test.go internal/interfaces/rest/reads.go internal/interfaces/rest/reads_test.go internal/interfaces/rest/server.go
git commit -m "feat: balance snapshot endpoint with as_of_seq"
```

---

### Task 2: Ledger history — `ListEntries` + `GET /groups/{group_id}/entries?after_seq=N`

**Files:**
- Modify: `internal/infrastructure/postgres/reads.go`, `internal/interfaces/rest/reads.go`, `internal/interfaces/rest/server.go`
- Test: `internal/infrastructure/postgres/reads_test.go`, `internal/interfaces/rest/reads_test.go` (append)

**Interfaces:**
- Produces:
  - `store.EntryRecord{ID uuid.UUID; Seq int64; Kind string; ReversesID *uuid.UUID; PayerID uuid.UUID; Counterparty *uuid.UUID; TotalAmount int64; SplitRule json.RawMessage; Participants []uuid.UUID; Memo *string; OccurredOn string; CreatedBy uuid.UUID; CreatedAt time.Time; Postings []ledger.Posting}` — JSON tags snake_case matching the field names (`reverses_id`, `payer_id`, `total_amount`, `split_rule`, `occurred_on`, `created_by`, `created_at`).
  - `(*Store) ListEntries(ctx context.Context, groupID uuid.UUID, afterSeq int64, limit int) ([]EntryRecord, error)` — seq ascending; limit clamped to [1,500], caller default 100.
  - Route `GET /groups/{group_id}/entries?after_seq=N&limit=M` → 200 + `{"entries":[…]}`.

- [ ] **Step 1: Write the failing store test**

Append to `internal/infrastructure/postgres/reads_test.go`:

```go
func TestListEntries_AfterSeqIncremental(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	e1, e2, e3 := uuid.New(), uuid.New(), uuid.New()
	addExpense(t, s, e1, rYuto, 3000, []uuid.UUID{rYuto, rMemA, rMemB})
	addExpense(t, s, e2, rMemA, 2000, []uuid.UUID{rMemA, rMemB})
	addExpense(t, s, e3, rMemB, 900, []uuid.UUID{rYuto, rMemA, rMemB})

	all, err := s.ListEntries(context.Background(), rGroup, 0, 100)
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
	tail, err := s.ListEntries(context.Background(), rGroup, all[1].Seq, 100)
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

	one, err := s.ListEntries(context.Background(), rGroup, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(one) != 1 {
		t.Fatalf("limit 1 returned %d entries", len(one))
	}
	// Nonsense limits fall back into range rather than erroring.
	if _, err := s.ListEntries(context.Background(), rGroup, 0, 0); err != nil {
		t.Fatalf("limit 0: %v", err)
	}
	if _, err := s.ListEntries(context.Background(), rGroup, 0, 10_000); err != nil {
		t.Fatalf("limit 10000: %v", err)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/infrastructure/postgres/ -v -run ListEntries`
Expected: compile FAIL — `undefined: EntryRecord` / `s.ListEntries undefined`.

- [ ] **Step 3: Implement**

Append to `internal/infrastructure/postgres/reads.go` (add imports `encoding/json`, `time`, `tallyup/internal/domain/ledger`):

```go
type EntryRecord struct {
	ID           uuid.UUID        `json:"id"`
	Seq          int64            `json:"seq"`
	Kind         string           `json:"kind"`
	ReversesID   *uuid.UUID       `json:"reverses_id,omitempty"`
	PayerID      uuid.UUID        `json:"payer_id"`
	Counterparty *uuid.UUID       `json:"counterparty,omitempty"`
	TotalAmount  int64            `json:"total_amount"`
	SplitRule    json.RawMessage  `json:"split_rule"`
	Participants []uuid.UUID      `json:"participants"`
	Memo         *string          `json:"memo,omitempty"`
	OccurredOn   string           `json:"occurred_on"`
	CreatedBy    uuid.UUID        `json:"created_by"`
	CreatedAt    time.Time        `json:"created_at"`
	Postings     []ledger.Posting `json:"postings"`
}

// ListEntries pages the ledger in seq order. No transaction needed: visible
// entries and postings are immutable (append-only), so two queries cannot
// disagree about rows they both see.
func (s *Store) ListEntries(ctx context.Context, groupID uuid.UUID, afterSeq int64, limit int) ([]EntryRecord, error) {
	if limit < 1 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, seq, kind, reverses_id, payer_id, counterparty, total_amount,
		       split_rule, participants, memo,
		       to_char(occurred_on, 'YYYY-MM-DD'), created_by, created_at
		FROM entries
		WHERE group_id = $1 AND seq > $2
		ORDER BY seq
		LIMIT $3`, groupID, afterSeq, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []EntryRecord{}
	index := map[uuid.UUID]int{}
	ids := []uuid.UUID{}
	for rows.Next() {
		var e EntryRecord
		if err := rows.Scan(&e.ID, &e.Seq, &e.Kind, &e.ReversesID, &e.PayerID,
			&e.Counterparty, &e.TotalAmount, &e.SplitRule, &e.Participants,
			&e.Memo, &e.OccurredOn, &e.CreatedBy, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Postings = []ledger.Posting{}
		index[e.ID] = len(entries)
		ids = append(ids, e.ID)
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return entries, nil
	}

	prows, err := s.Pool.Query(ctx, `
		SELECT entry_id, member_id, amount FROM postings
		WHERE entry_id = ANY($1)
		ORDER BY entry_id, member_id`, ids)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	for prows.Next() {
		var entryID uuid.UUID
		var p ledger.Posting
		if err := prows.Scan(&entryID, &p.MemberID, &p.Amount); err != nil {
			return nil, err
		}
		i := index[entryID]
		entries[i].Postings = append(entries[i].Postings, p)
	}
	return entries, prows.Err()
}
```

- [ ] **Step 4: Run store tests**

Run: `go test ./internal/infrastructure/postgres/ -v -run ListEntries`
Expected: PASS.

- [ ] **Step 5: Handler test, handler, route**

Append to `internal/interfaces/rest/reads_test.go`:

```go
func TestListEntries_Endpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New()))
	post(t, srv, uuid.New(), expenseBody(uuid.New()))

	var page struct {
		Entries []struct {
			Seq      int64 `json:"seq"`
			Postings []struct {
				Amount int64 `json:"amount"`
			} `json:"postings"`
		} `json:"entries"`
	}
	resp := getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/entries?after_seq=0", gID), &page)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if len(page.Entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(page.Entries))
	}
	if len(page.Entries[0].Postings) != 3 {
		t.Fatalf("postings missing: %+v", page.Entries[0])
	}

	resp = getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/entries?after_seq=%d", gID, page.Entries[0].Seq), &page)
	if len(page.Entries) != 1 {
		t.Fatalf("incremental fetch got %d entries, want 1", len(page.Entries))
	}
}
```

Append to `internal/interfaces/rest/reads.go` (add import `strconv`):

```go
func (s *Server) handleListEntries(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	afterSeq, _ := strconv.ParseInt(r.URL.Query().Get("after_seq"), 10, 64) // absent → 0
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))                    // absent → 0 → store default
	entries, err := s.store.ListEntries(r.Context(), groupID, afterSeq, limit)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "history read failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"entries": entries})
}
```

In `internal/interfaces/rest/server.go`:

```go
	mux.HandleFunc("GET /groups/{group_id}/entries", srv.handleListEntries)
```

- [ ] **Step 6: Run all tests, commit**

Run: `go test ./internal/infrastructure/postgres/ ./internal/interfaces/rest/ -v`
Expected: PASS.

```bash
git add internal/infrastructure/postgres/reads.go internal/infrastructure/postgres/reads_test.go internal/interfaces/rest/reads.go internal/interfaces/rest/reads_test.go internal/interfaces/rest/server.go
git commit -m "feat: after_seq ledger history endpoint"
```

---

### Task 3: Reverse an entry — `ReverseEntry` + `POST /groups/{group_id}/entries/{entry_id}/reverse`

**Files:**
- Create: `internal/infrastructure/postgres/reversals.go`, `internal/interfaces/rest/reversals.go`
- Modify: `internal/interfaces/rest/server.go`
- Test: `internal/infrastructure/postgres/reversals_test.go`, `internal/interfaces/rest/reversals_test.go`

**Interfaces:**
- Produces:
  - Sentinel errors: `store.ErrEntryNotFound`, `store.ErrAlreadyReversed`, `store.ErrNotReversible`.
  - `(*Store) ReverseEntry(ctx context.Context, key uuid.UUID, groupID, originalID, reversalID, createdBy uuid.UUID) ([]byte, error)` — one txn: `FOR UPDATE` lock on the original, reversed-already check, insert reversal entry (negated postings, `split_rule = {"type":"reversal"}`, original's `occurred_on`/payer/counterparty/participants/total), mark key succeeded. Response `{"id":…,"seq":N,"reverses_id":…}` (JSONB-normalized via `RETURNING response_body`).
  - Route `POST /groups/{group_id}/entries/{entry_id}/reverse`, body `{"id":"<client-minted reversal uuid>"}`, `Idempotency-Key` required. 201/200/409(in-flight)/409(already reversed)/404(not found)/422(kind=reversal)/400.
- HTTP mapping: `ErrAlreadyReversed` → 409, `ErrEntryNotFound` → 404, `ErrNotReversible` → 422. Pending key released on all post-gate failures.

- [ ] **Step 1: Write the failing store tests**

`internal/infrastructure/postgres/reversals_test.go`:

```go
package store

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
)

// reverse acquires a fresh idempotency key and calls ReverseEntry.
func reverse(t *testing.T, s *Store, originalID uuid.UUID) ([]byte, error) {
	t.Helper()
	key := uuid.New()
	if res, _, err := s.AcquireIdempotencyKey(context.Background(), key, key.String()); err != nil || res != GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	return s.ReverseEntry(context.Background(), key, rGroup, originalID, uuid.New(), rYuto)
}

func TestReverseEntry_NegatesAndZeroes(t *testing.T) {
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
	if rev.Kind != "reversal" || rev.ReversesID == nil || *rev.ReversesID != orig {
		t.Fatalf("bad reversal record: %+v", rev)
	}
	if rev.OccurredOn != entries[0].OccurredOn {
		t.Fatalf("reversal occurred_on %q != original %q", rev.OccurredOn, entries[0].OccurredOn)
	}
}

func TestReverseEntry_SecondReversalRejected(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	orig := uuid.New()
	addExpense(t, s, orig, rYuto, 3000, []uuid.UUID{rYuto, rMemA})

	if _, err := reverse(t, s, orig); err != nil {
		t.Fatal(err)
	}
	if _, err := reverse(t, s, orig); !errors.Is(err, ErrAlreadyReversed) {
		t.Fatalf("got %v, want ErrAlreadyReversed", err)
	}
}

func TestReverseEntry_ReversalNotReversible(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	orig := uuid.New()
	addExpense(t, s, orig, rYuto, 3000, []uuid.UUID{rYuto, rMemA})
	if _, err := reverse(t, s, orig); err != nil {
		t.Fatal(err)
	}
	entries, _ := s.ListEntries(context.Background(), rGroup, 0, 100)
	revID := entries[len(entries)-1].ID
	if _, err := reverse(t, s, revID); !errors.Is(err, ErrNotReversible) {
		t.Fatalf("got %v, want ErrNotReversible", err)
	}
}

func TestReverseEntry_UnknownEntry(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	if _, err := reverse(t, s, uuid.New()); !errors.Is(err, ErrEntryNotFound) {
		t.Fatalf("got %v, want ErrEntryNotFound", err)
	}
}

func TestReverseEntry_ConcurrentDoubleReversal_ExactlyOneWins(t *testing.T) {
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
			if res, _, err := s.AcquireIdempotencyKey(context.Background(), key, key.String()); err != nil || res != GateProceed {
				errs <- err
				return
			}
			_, err := s.ReverseEntry(context.Background(), key, rGroup, orig, revID, rYuto)
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
		case errors.Is(err, ErrAlreadyReversed):
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
		t.Fatalf("%d reversal entries exist, want exactly 1 (invariant 5)", n)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/infrastructure/postgres/ -v -run ReverseEntry`
Expected: compile FAIL — `undefined: ErrAlreadyReversed`, `s.ReverseEntry undefined`.

- [ ] **Step 3: Implement**

`internal/infrastructure/postgres/reversals.go`:

```go
package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrEntryNotFound   = errors.New("entry not found in this group")
	ErrAlreadyReversed = errors.New("entry already reversed")
	ErrNotReversible   = errors.New("reversal entries cannot be reversed")
)

// ReverseEntry appends a kind='reversal' entry whose postings are the exact
// negation of the original's. FOR UPDATE on the original serializes
// concurrent reversal attempts: the loser re-checks after the winner commits
// and sees the reversal (row locks don't fire the append-only trigger —
// only real UPDATE/DELETE do).
func (s *Store) ReverseEntry(ctx context.Context, key uuid.UUID, groupID, originalID, reversalID, createdBy uuid.UUID) ([]byte, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var kind string
	var payer uuid.UUID
	var counterparty *uuid.UUID
	var total int64
	var participants []uuid.UUID
	var occurredOn time.Time
	err = tx.QueryRow(ctx, `
		SELECT kind, payer_id, counterparty, total_amount, participants, occurred_on
		FROM entries WHERE id = $1 AND group_id = $2
		FOR UPDATE`, originalID, groupID).
		Scan(&kind, &payer, &counterparty, &total, &participants, &occurredOn)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrEntryNotFound
	}
	if err != nil {
		return nil, err
	}
	if kind == "reversal" {
		return nil, ErrNotReversible
	}

	var alreadyReversed bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM entries WHERE reverses_id = $1)`,
		originalID).Scan(&alreadyReversed); err != nil {
		return nil, err
	}
	if alreadyReversed {
		return nil, ErrAlreadyReversed
	}

	var seq int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO entries (id, group_id, kind, reverses_id, payer_id, counterparty,
		                     total_amount, split_rule, participants, occurred_on, created_by)
		VALUES ($1,$2,'reversal',$3,$4,$5,$6,'{"type":"reversal"}',$7,$8,$9)
		RETURNING seq`,
		reversalID, groupID, originalID, payer, counterparty, total,
		participants, occurredOn, createdBy).Scan(&seq); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO postings (entry_id, member_id, amount)
		SELECT $1, member_id, -amount FROM postings WHERE entry_id = $2`,
		reversalID, originalID); err != nil {
		return nil, err
	}

	snapshot := []byte(fmt.Sprintf(`{"id":%q,"seq":%d,"reverses_id":%q}`, reversalID, seq, originalID))
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

Run: `go test ./internal/infrastructure/postgres/ -v -race -run ReverseEntry`
Expected: PASS, including the 10-goroutine race — exactly one reversal wins.

- [ ] **Step 5: Handler tests, handler, route**

`internal/interfaces/rest/reversals_test.go`:

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

func postReverse(t *testing.T, srv *httptest.Server, key uuid.UUID, entryID, reversalID uuid.UUID) (*http.Response, []byte) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"id": reversalID, "requested_by": yuto})
	req, _ := http.NewRequest("POST",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s/reverse", gID, entryID),
		bytes.NewReader(body))
	req.Header.Set("Idempotency-Key", key.String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	return resp, rb
}

func TestReverse_Endpoint(t *testing.T) {
	srv, s := newTestServer(t)
	entryID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(entryID))

	resp, body := postReverse(t, srv, uuid.New(), entryID, uuid.New())
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s", resp.StatusCode, body)
	}

	// Second reversal → 409; unknown entry → 404.
	resp, _ = postReverse(t, srv, uuid.New(), entryID, uuid.New())
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("double reversal: status %d, want 409", resp.StatusCode)
	}
	resp, _ = postReverse(t, srv, uuid.New(), uuid.New(), uuid.New())
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown entry: status %d, want 404", resp.StatusCode)
	}

	var sum int64
	s.Pool.QueryRow(context.Background(), `SELECT COALESCE(SUM(amount),0) FROM postings`).Scan(&sum)
	if sum != 0 {
		t.Fatalf("global sum %d after reversal, want 0", sum)
	}
}

func TestReverse_ReplayIdempotent(t *testing.T) {
	srv, s := newTestServer(t)
	entryID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(entryID))

	key, revID := uuid.New(), uuid.New()
	resp1, body1 := postReverse(t, srv, key, entryID, revID)
	resp2, body2 := postReverse(t, srv, key, entryID, revID)
	if resp1.StatusCode != http.StatusCreated || resp2.StatusCode != http.StatusOK {
		t.Fatalf("statuses %d/%d, want 201/200", resp1.StatusCode, resp2.StatusCode)
	}
	if !bytes.Equal(body1, body2) {
		t.Fatalf("replay differs: %s vs %s", body1, body2)
	}
	var n int
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries WHERE kind='reversal'`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d reversals, want 1", n)
	}
}
```

(Add `"context"` and `"net/http/httptest"` to the import list; `gofmt` will order them.)

`internal/interfaces/rest/reversals.go`:

```go
package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"tallyup/internal/infrastructure/postgres"
)

type reverseRequest struct {
	ID          uuid.UUID `json:"id"`           // client-minted reversal entry id
	RequestedBy uuid.UUID `json:"requested_by"` // who is deleting (v1 has no authed identity)
}

func (s *Server) handleReverseEntry(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	entryID, err := uuid.Parse(r.PathValue("entry_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid entry id")
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

	var req reverseRequest
	if err := json.Unmarshal(body, &req); err != nil || req.ID == uuid.Nil || req.RequestedBy == uuid.Nil {
		httpError(w, http.StatusBadRequest, "body must be {\"id\": \"<uuid>\", \"requested_by\": \"<member uuid>\"}")
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

	resp, err := s.store.ReverseEntry(r.Context(), key, groupID, entryID, req.ID, req.RequestedBy)
	if err != nil {
		if relErr := s.store.ReleaseIdempotencyKey(r.Context(), key); relErr != nil {
			slog.Warn("release idempotency key", "key", key, "err", relErr)
		}
	}
	switch {
	case errors.Is(err, store.ErrEntryNotFound):
		httpError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, store.ErrAlreadyReversed):
		httpError(w, http.StatusConflict, err.Error())
	case errors.Is(err, store.ErrNotReversible):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case err != nil:
		httpError(w, http.StatusInternalServerError, "reversal failed")
	default:
		writeJSON(w, http.StatusCreated, resp)
	}
}
```

**Design note on `created_by`:** v1 has no authenticated caller identity, so the client states who is deleting via `requested_by` (mirroring how POST uses `payer_id` as `created_by`). The `members` FK guarantees it's a real member; per-group authorization joins the auth story, which is deferred like all v1 auth.

In `internal/interfaces/rest/server.go`:

```go
	mux.HandleFunc("POST /groups/{group_id}/entries/{entry_id}/reverse", srv.handleReverseEntry)
```

- [ ] **Step 6: Run all tests, commit**

Run: `go test ./internal/infrastructure/postgres/ ./internal/interfaces/rest/ -v -race`
Expected: PASS.

```bash
git add internal/infrastructure/postgres/reversals.go internal/infrastructure/postgres/reversals_test.go internal/interfaces/rest/reversals.go internal/interfaces/rest/reversals_test.go internal/interfaces/rest/server.go
git commit -m "feat: entry reversal with row-lock against double-reversal"
```

---

### Task 4: Edit an entry — `EditEntry` + `PUT /groups/{group_id}/entries/{entry_id}`

**Files:**
- Modify: `internal/infrastructure/postgres/reversals.go`, `internal/interfaces/rest/reversals.go`, `internal/interfaces/rest/server.go`
- Test: `internal/infrastructure/postgres/reversals_test.go`, `internal/interfaces/rest/reversals_test.go` (append)

**Interfaces:**
- Consumes: the lock/check/insert-reversal steps from Task 3 (extracted into an unexported helper), `CreateEntry`'s insert logic (extracted likewise), `ledger.ComputePostings`.
- Produces:
  - `(*Store) EditEntry(ctx context.Context, key uuid.UUID, groupID, originalID, reversalID uuid.UUID, in EntryInput, postings []ledger.Posting) ([]byte, error)` — ONE transaction: reverse the original (same lock + checks as Task 3), then insert the replacement entry + postings, then mark the key. Response `{"id":…,"seq":N,"reversal_id":…}`.
  - Route `PUT /groups/{group_id}/entries/{entry_id}` — body is the Phase 1–2 create payload plus `"reversal_id": "<uuid>"` and `"requested_by"` is `payer_id` (the editor supplies the corrected entry; its `created_by` is its payer, matching POST semantics).
- **Refactor requirement:** Task 3's `ReverseEntry` and this task must share one private `reverseWithinTx(ctx, tx, groupID, originalID, reversalID, createdBy) (seq int64, err error)` helper, and `CreateEntry`'s entry+postings insert must be extracted to `insertEntryWithinTx(ctx, tx, in EntryInput, postings []ledger.Posting) (seq int64, err error)` so `EditEntry` composes both inside its own transaction. No duplicated SQL blocks between the three exported methods.

- [ ] **Step 1: Write the failing store test**

Append to `internal/infrastructure/postgres/reversals_test.go`:

```go
func TestEditEntry_ReverseAndReplaceAtomically(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	orig := uuid.New()
	// Original: yuto pays 12000, 3-way equal → yuto +8000, a −4000, b −4000.
	addExpense(t, s, orig, rYuto, 12000, []uuid.UUID{rYuto, rMemA, rMemB})

	// Edit: actually it was 9000, and only yuto and a shared it.
	newID, revID, key := uuid.New(), uuid.New(), uuid.New()
	postings, err := ledger.ComputePostings(rYuto, 9000,
		ledger.SplitRule{Type: ledger.SplitEqual}, []uuid.UUID{rYuto, rMemA})
	if err != nil {
		t.Fatal(err)
	}
	if res, _, err := s.AcquireIdempotencyKey(context.Background(), key, key.String()); err != nil || res != GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	if _, err := s.EditEntry(context.Background(), key, rGroup, orig, revID, EntryInput{
		ID: newID, GroupID: rGroup, Kind: "expense", PayerID: rYuto,
		TotalAmount: 9000, SplitRule: []byte(`{"type":"equal"}`),
		Participants: []uuid.UUID{rYuto, rMemA},
		OccurredOn:   time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC), CreatedBy: rYuto,
	}, postings); err != nil {
		t.Fatal(err)
	}

	// Net effect: only the corrected entry counts. yuto +4500, a −4500, b 0.
	snap, err := s.GetBalances(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	want := []MemberBalance{{rYuto, 4500}, {rMemA, -4500}, {rMemB, 0}}
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
	if res, _, err := s.AcquireIdempotencyKey(context.Background(), key2, key2.String()); err != nil || res != GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}
	_, err = s.EditEntry(context.Background(), key2, rGroup, orig, uuid.New(), EntryInput{
		ID: uuid.New(), GroupID: rGroup, Kind: "expense", PayerID: rYuto,
		TotalAmount: 100, SplitRule: []byte(`{"type":"equal"}`),
		Participants: []uuid.UUID{rYuto},
		OccurredOn:   time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC), CreatedBy: rYuto,
	}, []ledger.Posting{})
	if !errors.Is(err, ErrAlreadyReversed) {
		t.Fatalf("second edit: got %v, want ErrAlreadyReversed", err)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/infrastructure/postgres/ -v -run EditEntry`
Expected: compile FAIL — `s.EditEntry undefined`.

- [ ] **Step 3: Refactor + implement**

First extract the two helpers (behavior-preserving refactor; run the existing suite after):

In `internal/infrastructure/postgres/reversals.go`, move the body of `ReverseEntry` between `Begin` and the idempotency-key update into:

```go
// reverseWithinTx locks the original, rejects double/invalid reversals, and
// appends the reversal entry + negated postings. Caller owns the transaction.
func reverseWithinTx(ctx context.Context, tx pgx.Tx, groupID, originalID, reversalID, createdBy uuid.UUID) (int64, error) {
	// (exact code from Task 3: FOR UPDATE select, kind check, EXISTS check,
	//  INSERT reversal entry RETURNING seq, INSERT negated postings)
}
```

…with `ReverseEntry` becoming: begin, `seq, err := reverseWithinTx(…)`, build snapshot, mark key with `RETURNING response_body`, commit. **Copy the SQL verbatim from Task 3 — the helper is a cut-and-paste extraction, not a rewrite.**

In `internal/infrastructure/postgres/entries.go`, extract from `CreateEntry` the membership check + entry insert + postings insert into:

```go
// insertEntryWithinTx validates membership and appends one entry with its
// postings. Caller owns the transaction and has already zero-sum-checked.
func insertEntryWithinTx(ctx context.Context, tx pgx.Tx, in EntryInput, postings []ledger.Posting) (int64, error) {
	// (exact code from the Phase 1-2 plan's CreateEntry: membership count
	//  check, INSERT entries RETURNING seq mapping 23505 → ErrDuplicateEntryID,
	//  postings loop)
}
```

…with `CreateEntry` becoming: zero-sum assert, begin, `seq, err := insertEntryWithinTx(…)`, mark key, commit.

Run: `go test ./internal/infrastructure/postgres/ ./internal/interfaces/rest/ -race` — the refactor must be green before continuing.

Then `EditEntry` in `internal/infrastructure/postgres/reversals.go`:

```go
// EditEntry = reversal + replacement in one transaction (architecture §3):
// either both land or neither does.
func (s *Store) EditEntry(ctx context.Context, key uuid.UUID, groupID, originalID, reversalID uuid.UUID, in EntryInput, postings []ledger.Posting) ([]byte, error) {
	var sum int64
	for _, p := range postings {
		sum += p.Amount
	}
	if sum != 0 {
		return nil, fmt.Errorf("postings sum to %d, refusing to write", sum)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := reverseWithinTx(ctx, tx, groupID, originalID, reversalID, in.CreatedBy); err != nil {
		return nil, err
	}
	seq, err := insertEntryWithinTx(ctx, tx, in, postings)
	if err != nil {
		return nil, err
	}

	snapshot := []byte(fmt.Sprintf(`{"id":%q,"seq":%d,"reversal_id":%q}`, in.ID, seq, reversalID))
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

Run: `go test ./internal/infrastructure/postgres/ -v -race`
Expected: PASS (new EditEntry test + all prior tests still green after the refactor).

- [ ] **Step 5: Handler test, handler, route**

Append to `internal/interfaces/rest/reversals_test.go`:

```go
func TestEdit_Endpoint(t *testing.T) {
	srv, s := newTestServer(t)
	entryID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(entryID)) // 12000 3-way

	body, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "reversal_id": uuid.New(),
		"kind": "expense", "payer_id": yuto, "total_amount": 9000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, memA},
		"occurred_on":  "2026-07-05",
	})
	req, _ := http.NewRequest("PUT",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s", gID, entryID), bytes.NewReader(body))
	req.Header.Set("Idempotency-Key", uuid.New().String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusCreated {
		rb, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d, body %s", resp.StatusCode, rb)
	}

	var n int
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries`).Scan(&n)
	if n != 3 {
		t.Fatalf("%d entries after edit, want 3 (original + reversal + replacement)", n)
	}
	var sum int64
	s.Pool.QueryRow(context.Background(), `SELECT COALESCE(SUM(amount),0) FROM postings`).Scan(&sum)
	if sum != 0 {
		t.Fatalf("global sum %d, want 0", sum)
	}
}
```

Append to `internal/interfaces/rest/reversals.go` — the edit handler reuses the create-payload decoding from `entries.go` by widening `createEntryRequest` with one optional field (in `internal/interfaces/rest/entries.go`):

```go
type createEntryRequest struct {
	// … existing fields unchanged …
	ReversalID uuid.UUID `json:"reversal_id,omitempty"` // PUT (edit) only
}
```

```go
func (s *Server) handleEditEntry(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	originalID, err := uuid.Parse(r.PathValue("entry_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid entry id")
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

	var req createEntryRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.ID == uuid.Nil || req.ReversalID == uuid.Nil {
		httpError(w, http.StatusBadRequest, "id and reversal_id required")
		return
	}
	if req.Kind != "expense" && req.Kind != "settlement" {
		httpError(w, http.StatusBadRequest, "kind must be expense or settlement")
		return
	}
	occurredOn, err := time.Parse("2006-01-02", req.OccurredOn)
	if err != nil {
		httpError(w, http.StatusBadRequest, "occurred_on must be YYYY-MM-DD")
		return
	}

	postings, splitJSON, participants, perr := buildPostings(req)
	if perr != nil {
		httpError(w, http.StatusUnprocessableEntity, perr.Error())
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

	resp, err := s.store.EditEntry(r.Context(), key, groupID, originalID, req.ReversalID, store.EntryInput{
		ID: req.ID, GroupID: groupID, Kind: req.Kind, PayerID: req.PayerID,
		Counterparty: req.Counterparty, TotalAmount: req.TotalAmount,
		SplitRule: splitJSON, Participants: participants, Memo: req.Memo,
		OccurredOn: occurredOn, CreatedBy: req.PayerID,
	}, postings)
	if err != nil {
		if relErr := s.store.ReleaseIdempotencyKey(r.Context(), key); relErr != nil {
			slog.Warn("release idempotency key", "key", key, "err", relErr)
		}
	}
	switch {
	case errors.Is(err, store.ErrEntryNotFound):
		httpError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, store.ErrAlreadyReversed):
		httpError(w, http.StatusConflict, err.Error())
	case errors.Is(err, store.ErrNotReversible):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, store.ErrNotGroupMembers):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, store.ErrDuplicateEntryID):
		httpError(w, http.StatusConflict, err.Error())
	case err != nil:
		httpError(w, http.StatusInternalServerError, "edit failed")
	default:
		writeJSON(w, http.StatusCreated, resp)
	}
}
```

**Second refactor requirement:** `buildPostings(req createEntryRequest) ([]ledger.Posting, []byte, []uuid.UUID, error)` does not exist yet — extract it from the POST handler's `switch req.Kind` block in `internal/interfaces/rest/entries.go` (the expense/settlement postings computation, split-rule marshaling, and participant normalization), and make the POST handler call it too. One decode path, two endpoints.

In `internal/interfaces/rest/server.go`:

```go
	mux.HandleFunc("PUT /groups/{group_id}/entries/{entry_id}", srv.handleEditEntry)
```

- [ ] **Step 6: Run everything, commit**

Run: `go test ./... -race`
Expected: PASS.

```bash
git add internal/infrastructure/postgres/ internal/interfaces/rest/
git commit -m "feat: atomic edit as reversal plus replacement entry"
```

---

### Task 5: Integrity checks — `CheckIntegrity`

**Files:**
- Create: `internal/infrastructure/postgres/integrity.go`
- Test: `internal/infrastructure/postgres/integrity_test.go`

**Interfaces:**
- Produces:
  - `store.IntegrityReport{GlobalSum int64; EntriesWithNonzeroSum int; DoublyReversedOriginals int}` with method `(IntegrityReport) OK() bool` (true iff all three are zero).
  - `(*Store) CheckIntegrity(ctx context.Context) (IntegrityReport, error)` — implements the three checks from architecture §5: global zero-sum, per-entry zero-sum, at-most-one reversal per original. Callable from a future admin endpoint or cron; for now the chaos phase and tests use it directly.

- [ ] **Step 1: Write the failing test**

`internal/infrastructure/postgres/integrity_test.go`:

```go
package store

import (
	"context"
	"testing"

	"github.com/google/uuid"
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
```

*(A dirty-ledger test would require corrupting append-only tables, which the trigger correctly prevents — the checks' SQL is exercised for the counting-zero path, and the chaos phase re-runs them after real concurrent load.)*

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/infrastructure/postgres/ -v -run CheckIntegrity`
Expected: compile FAIL — `s.CheckIntegrity undefined`.

- [ ] **Step 3: Implement**

`internal/infrastructure/postgres/integrity.go`:

```go
package store

import "context"

// IntegrityReport is the result of the architecture §5 integrity checks.
// All-zero means the ledger's invariants hold.
type IntegrityReport struct {
	GlobalSum               int64 `json:"global_sum"`
	EntriesWithNonzeroSum   int   `json:"entries_with_nonzero_sum"`
	DoublyReversedOriginals int   `json:"doubly_reversed_originals"`
}

func (r IntegrityReport) OK() bool {
	return r.GlobalSum == 0 && r.EntriesWithNonzeroSum == 0 && r.DoublyReversedOriginals == 0
}

func (s *Store) CheckIntegrity(ctx context.Context) (IntegrityReport, error) {
	var rep IntegrityReport
	if err := s.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM postings`).Scan(&rep.GlobalSum); err != nil {
		return rep, err
	}
	if err := s.Pool.QueryRow(ctx, `
		SELECT count(*) FROM (
			SELECT entry_id FROM postings GROUP BY entry_id HAVING SUM(amount) <> 0
		) bad`).Scan(&rep.EntriesWithNonzeroSum); err != nil {
		return rep, err
	}
	if err := s.Pool.QueryRow(ctx, `
		SELECT count(*) FROM (
			SELECT reverses_id FROM entries WHERE reverses_id IS NOT NULL
			GROUP BY reverses_id HAVING count(*) > 1
		) bad`).Scan(&rep.DoublyReversedOriginals); err != nil {
		return rep, err
	}
	return rep, nil
}
```

- [ ] **Step 4: Run all tests, commit**

Run: `go test ./... -race`
Expected: PASS.

```bash
git add internal/infrastructure/postgres/integrity.go internal/infrastructure/postgres/integrity_test.go
git commit -m "feat: ledger integrity checks"
```

---

## Deferred / notes for later plans

- `GET /groups/{id}/balance` and the history endpoint do not 404 on unknown groups (they return empty results) — acceptable until the auth/groups work in the client plan gives groups a real existence check.
- The settle-up plan (Phase 6) consumes `BalanceSnapshot.AsOfSeq` as its optimistic-concurrency token.
- SSE upgrade of the history poll is v1.1 (architecture §2).
