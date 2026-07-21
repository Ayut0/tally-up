# Reads + Reversals (DDD layout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the read side (balances with snapshot seq, `after_seq` ledger history) and the correction side (reverse and edit as appending entries, with a row lock preventing double-reversal) for issue #5, implemented against the DDD layout landed by issue #59/PR #60 (`domain/`, `application/`, `infrastructure/postgres/`, `interfaces/rest/`) rather than the flat `internal/store` + `internal/api` layout the original 2026-07-05 plan (`docs/superpowers/plans/2026-07-05-reads-and-reversals.md`) was written against. This plan supersedes that one — do not follow its file paths.

**Architecture:** Same runtime design as the superseded plan (balances are a pure derivation read in one MVCC snapshot; reversals append a `kind='reversal'` entry with negated postings under `SELECT … FOR UPDATE`; edit = reversal + new entry in one transaction) but mapped onto the current package boundaries:
- `domain/entry` gains the read-model types (`Record`, `MemberBalance`, `BalanceSnapshot`) and four new single-method ports — `BalanceReader`, `HistoryReader`, `Reverser`, `Editor` — following the same interface-segregation style as the existing `Repository`/`IdempotencyGate` ports. One method per port (rather than one bundled `Reader`/`CorrectionRepository` interface) is deliberate: it's what lets each task below implement exactly one new `*Store` method and stay independently compilable and testable — a task that needed the *next* task's method to satisfy a fatter interface would fail Task Right-Sizing.
- `application/correctentry` is a new sibling to `application/addentry`: it orchestrates gate-acquire → persist → release-on-failure for `Reverse` and `Edit`, exactly like `addentry.AddEntry` does for create. Its `Service` struct grows one field per task (`Reverses entry.Reverser` in Task 3, `Edits entry.Editor` in Task 4) — same pattern `addentry.Service{Gate, Entries}` already uses. `Edit` reuses `addentry.ComputePostings` (exported from this plan's Task 4) instead of duplicating the kind-switch postings logic.
- `infrastructure/postgres` implements the two new ports on the existing `*Store`, extracting `insertEntryWithinTx` (from `Create`) and `reverseWithinTx` (shared by `Reverse` and `Edit`) so there is exactly one copy of each SQL block.
- `interfaces/rest` adds two new handler files and grows `Server`/`NewServer` incrementally.

Per ADR `docs/adr/0001-ddd-tactical-scope.md`: no rich `Entry` aggregate here either — `entry.Input`/`entry.Record`/command DTOs stay plain data, and membership stays enforced transactionally in Postgres (already true for `Create`; `Reverse`/`Edit` don't re-touch membership since they reverse/replace an entry whose members were already validated, except `Edit`'s replacement entry, which re-validates via `insertEntryWithinTx` exactly like `Create` does).

**Tech Stack:** Go 1.25, stdlib `net/http`, `pgx/v5`, Postgres via `docker compose` (already running on `localhost:5433`), `TEST_DATABASE_URL`-gated integration tests (`make test` / `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test -p 1 ./... -race`).

## Global Constraints

- Money is integer yen in `int64`. No floats.
- `entries`/`postings` are append-only (DB trigger enforced already); corrections only ever append. `FOR UPDATE` row locks are allowed (no trigger fires); UPDATE/DELETE are not.
- A non-reversal entry is reversed **at most once**; reversal entries themselves cannot be reversed.
- A reversal's postings are the exact negation of the original's; its `occurred_on` copies the original's.
- Every write endpoint requires an `Idempotency-Key` header and follows the existing gate contract: 201 first success / 200 byte-identical replay / 409 in-flight / 422 hash mismatch; pending keys are released on post-gate failure (see `application/addentry/addentry.go` for the reference pattern).
- Balance responses include `as_of_seq` — the max entry `seq` the balances reflect — read in the **same SQL statement** as the balances so both come from one MVCC snapshot.
- History (`ListEntries`) needs no transaction: entries and postings are immutable once visible.
- No new migration: `internal/infrastructure/postgres/migrations/0001_init.up.sql` already has `kind IN ('expense','settlement','reversal')`, `reverses_id`, and the `balances` view.
- Branch: `feat/issue-5-reads-and-reversals` (already created from `origin/main`, in worktree `.claude/worktrees/feat+issue-5-reads-and-reversals`).
- Naming: no package/type stutter — `entry.Record` not `entry.EntryRecord`, `entry.BalanceReader` not `entry.EntryBalanceReader`.

## File Structure

```
internal/domain/entry/entry.go                    — modify: KindReversal const, sentinel errors, MemberBalance/BalanceSnapshot/Record types, BalanceReader + HistoryReader + Reverser + Editor ports (one per task)
internal/application/addentry/addentry.go         — modify: export computePostings → ComputePostings (no behavior change)
internal/application/correctentry/correctentry.go — create: Service{Gate, Corrections}, ReverseCommand/EditCommand, Reverse()/Edit()
internal/infrastructure/postgres/reads.go          — create: GetBalances, ListEntries
internal/infrastructure/postgres/reads_test.go     — create
internal/infrastructure/postgres/entry_repository.go — modify: extract insertEntryWithinTx + assertZeroSum helpers from Create
internal/infrastructure/postgres/reversals.go      — create: reverseWithinTx, Reverse, Edit
internal/infrastructure/postgres/reversals_test.go — create
internal/infrastructure/postgres/integrity.go      — create: CheckIntegrity + IntegrityReport
internal/infrastructure/postgres/integrity_test.go — create
internal/interfaces/rest/reads.go                  — create: handleGetBalance, handleListEntries
internal/interfaces/rest/reads_test.go             — create
internal/interfaces/rest/reversals.go              — create: handleReverseEntry, handleEditEntry
internal/interfaces/rest/reversals_test.go         — create
internal/interfaces/rest/entries.go                — modify: add ReversalID field to createEntryRequest
internal/interfaces/rest/entries_test.go           — modify: newTestServer grows reader (Task 1) then corrections (Task 3)
internal/interfaces/rest/server.go                 — modify: Server struct + NewServer signature, register 4 routes
cmd/api/main.go                                    — modify: wire correctentry.Service, pass reader + corrections to rest.NewServer
```

---

### Task 1: Balance snapshot — `domain/entry.BalanceReader` + `Store.GetBalances` + `GET /groups/{group_id}/balance`

**Files:**
- Modify: `internal/domain/entry/entry.go`
- Create: `internal/infrastructure/postgres/reads.go`, `internal/infrastructure/postgres/reads_test.go`, `internal/interfaces/rest/reads.go`
- Modify: `internal/interfaces/rest/server.go`, `internal/interfaces/rest/entries_test.go`, `cmd/api/main.go`

**Interfaces:**
- Consumes: `postgres.TestStore`, `entry.Repository.Create`, `entry.IdempotencyGate.Acquire` (existing, for test fixtures), `ledger.ComputePostings`, `ledger.SplitRule`/`ledger.SplitEqual`.
- Produces:
  - `entry.MemberBalance{MemberID uuid.UUID; Balance int64}` (JSON `member_id`, `balance`)
  - `entry.BalanceSnapshot{Balances []MemberBalance; AsOfSeq int64}` (JSON `balances`, `as_of_seq`)
  - `entry.Record` type (the ledger-history row shape) — declared now since it's a small, obviously-related read-model type, but not consumed by anything until Task 2.
  - `entry.BalanceReader` interface: `GetBalances(ctx, groupID uuid.UUID) (BalanceSnapshot, error)` — the only method on it, deliberately, so `*Store` satisfies it the moment `GetBalances` exists (no forward reference to Task 2's `ListEntries`).
  - `(*postgres.Store) GetBalances(...)` implementing it — every group member appears (zero balances included), ordered by member UUID bytes ascending.
  - Route `GET /groups/{group_id}/balance` → 200 + `BalanceSnapshot` JSON.
  - `rest.NewServer(entries *addentry.Service, balances entry.BalanceReader) http.Handler` — signature grows by one param (was `NewServer(entries *addentry.Service)`).

- [ ] **Step 1: Add the `BalanceReader` port and read-model types to the domain**

In `internal/domain/entry/entry.go`, add the import `encoding/json` (`time` is already imported), then append:

```go
// MemberBalance is one member's net position: positive = is owed, negative
// = owes.
type MemberBalance struct {
	MemberID uuid.UUID `json:"member_id"`
	Balance  int64     `json:"balance"`
}

// BalanceSnapshot is every group member's balance plus the max entry seq
// those balances reflect — both read from one SQL statement (one MVCC
// snapshot), so AsOfSeq is exactly the ledger state the balances derive
// from. This is the optimistic-concurrency token a future settle-up plan
// builds on.
type BalanceSnapshot struct {
	Balances []MemberBalance `json:"balances"`
	AsOfSeq  int64           `json:"as_of_seq"`
}

// Record is one entry plus its postings, as returned by ledger history.
type Record struct {
	ID           uuid.UUID       `json:"id"`
	Seq          int64           `json:"seq"`
	Kind         Kind            `json:"kind"`
	ReversesID   *uuid.UUID      `json:"reverses_id,omitempty"`
	PayerID      uuid.UUID       `json:"payer_id"`
	Counterparty *uuid.UUID      `json:"counterparty,omitempty"`
	TotalAmount  int64           `json:"total_amount"`
	SplitRule    json.RawMessage `json:"split_rule"`
	Participants []uuid.UUID     `json:"participants"`
	Memo         *string         `json:"memo,omitempty"`
	OccurredOn   string          `json:"occurred_on"`
	CreatedBy    uuid.UUID       `json:"created_by"`
	CreatedAt    time.Time       `json:"created_at"`
	Postings     []ledger.Posting `json:"postings"`
}

// BalanceReader is the read-side port for derived balances — a pure query,
// no idempotency gate involved.
type BalanceReader interface {
	GetBalances(ctx context.Context, groupID uuid.UUID) (BalanceSnapshot, error)
}
```

Run `gofmt -l internal/domain/entry/entry.go` after — the `Record` struct field alignment above is intentionally rough; gofmt fixes it. `Record` has no reader yet in this task — `HistoryReader` and its use lands in Task 2 — so nothing references it until then, which is fine; Go doesn't require a type to be used.

- [ ] **Step 2: Write the failing store test**

`internal/infrastructure/postgres/reads_test.go`:

```go
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
```

- [ ] **Step 3: Run to verify failure**

Run: `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test ./internal/infrastructure/postgres/ -v -run GetBalances`
Expected: compile FAIL — `s.GetBalances undefined`.

- [ ] **Step 4: Implement the store read**

`internal/infrastructure/postgres/reads.go`:

```go
package postgres

import (
	"context"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
)

var _ entry.BalanceReader = (*Store)(nil)

// GetBalances returns every group member's net position plus the max entry
// seq those balances reflect. Both come from ONE statement, hence one MVCC
// snapshot — as_of_seq is exactly the ledger state the balances derive from.
func (s *Store) GetBalances(ctx context.Context, groupID uuid.UUID) (entry.BalanceSnapshot, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT gm.member_id,
		       COALESCE(b.balance, 0),
		       (SELECT COALESCE(MAX(seq), 0) FROM entries e WHERE e.group_id = $1)
		FROM group_members gm
		LEFT JOIN balances b ON b.group_id = gm.group_id AND b.member_id = gm.member_id
		WHERE gm.group_id = $1
		ORDER BY gm.member_id`, groupID)
	if err != nil {
		return entry.BalanceSnapshot{}, err
	}
	defer rows.Close()

	snap := entry.BalanceSnapshot{Balances: []entry.MemberBalance{}}
	for rows.Next() {
		var mb entry.MemberBalance
		if err := rows.Scan(&mb.MemberID, &mb.Balance, &snap.AsOfSeq); err != nil {
			return entry.BalanceSnapshot{}, err
		}
		snap.Balances = append(snap.Balances, mb)
	}
	return snap, rows.Err()
}
```

This compiles and is fully testable standalone — `ListEntries` is added to this same file in Task 2, as a separate function with its own `var _ entry.HistoryReader = (*Store)(nil)` assertion.

- [ ] **Step 5: Route + handler**

`internal/interfaces/rest/reads.go`:

```go
package rest

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
	snap, err := s.balances.GetBalances(r.Context(), groupID)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "balance read failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(snap)
}
```

(`handleListEntries` — and the `strconv` import it needs — is added to this same file in Task 2. Don't add `strconv` yet; it would be an unused import until then.)

In `internal/interfaces/rest/server.go`, replace the whole file:

```go
// Package rest is the thin HTTP layer: decode, build a command, call the
// application service, translate the result.
package rest

import (
	"net/http"

	"tallyup/internal/application/addentry"
	"tallyup/internal/domain/entry"
)

type Server struct {
	entries  *addentry.Service
	balances entry.BalanceReader
}

func NewServer(entries *addentry.Service, balances entry.BalanceReader) http.Handler {
	srv := &Server{entries: entries, balances: balances}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /groups/{group_id}/entries", srv.handleCreateEntry)
	mux.HandleFunc("GET /groups/{group_id}/balance", srv.handleGetBalance)
	return mux
}
```

(The `GET /groups/{group_id}/entries` route is registered in Task 2, once `handleListEntries` exists — registering a route for a handler that doesn't exist yet wouldn't compile.)

- [ ] **Step 6: Fix the now-broken test helper and main.go**

In `internal/interfaces/rest/entries_test.go`, change `newTestServer`:

```go
func newTestServer(t *testing.T) (*httptest.Server, *postgres.Store) {
	s := postgres.TestStore(t)
	seedGroup(t, s)
	svc := &addentry.Service{Gate: s, Entries: s}
	srv := httptest.NewServer(NewServer(svc, s))
	t.Cleanup(srv.Close)
	return srv, s
}
```

`s` (`*postgres.Store`) already satisfies `entry.BalanceReader` at this point — no forward reference needed.

In `cmd/api/main.go`, change the `NewServer` call:

```go
	entries := &addentry.Service{Gate: s, Entries: s}
	srv := &http.Server{Addr: ":" + port, Handler: rest.NewServer(entries, s)}
```

- [ ] **Step 7: Write the failing handler test**

`internal/interfaces/rest/reads_test.go`:

```go
package rest

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

- [ ] **Step 8: Run everything, commit**

Run: `go build ./... && TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test -p 1 ./... -race`
Expected: PASS.

```bash
git add internal/domain/entry/entry.go internal/infrastructure/postgres/reads.go internal/infrastructure/postgres/reads_test.go internal/interfaces/rest/reads.go internal/interfaces/rest/reads_test.go internal/interfaces/rest/server.go internal/interfaces/rest/entries_test.go cmd/api/main.go
git commit -m "feat: balance snapshot endpoint with as_of_seq"
```

---

### Task 2: Ledger history — `domain/entry.HistoryReader` + `Store.ListEntries` + `GET /groups/{group_id}/entries?after_seq=N`

**Files:**
- Modify: `internal/domain/entry/entry.go`, `internal/infrastructure/postgres/reads.go`, `internal/infrastructure/postgres/reads_test.go`, `internal/interfaces/rest/reads.go`, `internal/interfaces/rest/reads_test.go`, `internal/interfaces/rest/server.go`, `internal/interfaces/rest/entries_test.go`, `cmd/api/main.go`

**Interfaces:**
- Produces:
  - `entry.HistoryReader` interface: `ListEntries(ctx, groupID uuid.UUID, afterSeq int64, limit int) ([]Record, error)` — its own single-method port, mirroring `BalanceReader`.
  - `(*postgres.Store) ListEntries(...)` implementing it — seq ascending; limit clamped to [1,500], caller-absent (`0`) defaults to 100.
  - Route `GET /groups/{group_id}/entries?after_seq=N&limit=M` → 200 + `{"entries":[…]}`.
  - `rest.NewServer(entries *addentry.Service, balances entry.BalanceReader, history entry.HistoryReader) http.Handler` — signature grows by one param.

- [ ] **Step 1: Add the `HistoryReader` port**

In `internal/domain/entry/entry.go`, append (after `BalanceReader`):

```go
// HistoryReader is the read-side port for paginated ledger history — a
// pure query, no idempotency gate involved.
type HistoryReader interface {
	ListEntries(ctx context.Context, groupID uuid.UUID, afterSeq int64, limit int) ([]Record, error)
}
```

- [ ] **Step 2: Append the failing store tests**

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

- [ ] **Step 3: Implement**

Append to `internal/infrastructure/postgres/reads.go` (add import `tallyup/internal/domain/ledger`):

```go
var _ entry.HistoryReader = (*Store)(nil)

// ListEntries pages the ledger in seq order. No transaction needed: visible
// entries and postings are immutable (append-only), so two queries cannot
// disagree about rows they both see.
func (s *Store) ListEntries(ctx context.Context, groupID uuid.UUID, afterSeq int64, limit int) ([]entry.Record, error) {
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

	entries := []entry.Record{}
	index := map[uuid.UUID]int{}
	ids := []uuid.UUID{}
	for rows.Next() {
		var e entry.Record
		var kind string
		if err := rows.Scan(&e.ID, &e.Seq, &kind, &e.ReversesID, &e.PayerID,
			&e.Counterparty, &e.TotalAmount, &e.SplitRule, &e.Participants,
			&e.Memo, &e.OccurredOn, &e.CreatedBy, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Kind = entry.Kind(kind)
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

Run: `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test ./internal/infrastructure/postgres/ -v -run 'GetBalances|ListEntries'`
Expected: PASS.

- [ ] **Step 5: Handler + route + wiring**

In `internal/interfaces/rest/reads.go`, add `"strconv"` to the import block, then append:

```go
func (s *Server) handleListEntries(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	afterSeq, _ := strconv.ParseInt(r.URL.Query().Get("after_seq"), 10, 64) // absent → 0
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))                    // absent → 0 → store default
	entries, err := s.history.ListEntries(r.Context(), groupID, afterSeq, limit)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "history read failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"entries": entries})
}
```

In `internal/interfaces/rest/server.go`, grow `Server` and `NewServer`:

```go
type Server struct {
	entries  *addentry.Service
	balances entry.BalanceReader
	history  entry.HistoryReader
}

func NewServer(entries *addentry.Service, balances entry.BalanceReader, history entry.HistoryReader) http.Handler {
	srv := &Server{entries: entries, balances: balances, history: history}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /groups/{group_id}/entries", srv.handleCreateEntry)
	mux.HandleFunc("GET /groups/{group_id}/balance", srv.handleGetBalance)
	mux.HandleFunc("GET /groups/{group_id}/entries", srv.handleListEntries)
	return mux
}
```

In `internal/interfaces/rest/entries_test.go`, update `newTestServer`:

```go
func newTestServer(t *testing.T) (*httptest.Server, *postgres.Store) {
	s := postgres.TestStore(t)
	seedGroup(t, s)
	svc := &addentry.Service{Gate: s, Entries: s}
	srv := httptest.NewServer(NewServer(svc, s, s))
	t.Cleanup(srv.Close)
	return srv, s
}
```

In `cmd/api/main.go`, update the `NewServer` call:

```go
	entries := &addentry.Service{Gate: s, Entries: s}
	srv := &http.Server{Addr: ":" + port, Handler: rest.NewServer(entries, s, s)}
```

- [ ] **Step 6: Append the failing handler test**

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

- [ ] **Step 7: Run everything, commit**

Run: `go build ./... && TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test -p 1 ./... -race`
Expected: PASS.

```bash
git add internal/domain/entry/entry.go internal/infrastructure/postgres/reads.go internal/infrastructure/postgres/reads_test.go internal/interfaces/rest/reads.go internal/interfaces/rest/reads_test.go internal/interfaces/rest/server.go internal/interfaces/rest/entries_test.go cmd/api/main.go
git commit -m "feat: after_seq ledger history endpoint"
```

---

### Task 3: Reverse an entry — `domain/entry.Reverser` + `POST /groups/{group_id}/entries/{entry_id}/reverse`

**Files:**
- Modify: `internal/domain/entry/entry.go`
- Create: `internal/application/correctentry/correctentry.go`, `internal/infrastructure/postgres/reversals.go`, `internal/infrastructure/postgres/reversals_test.go`, `internal/interfaces/rest/reversals.go`, `internal/interfaces/rest/reversals_test.go`
- Modify: `internal/interfaces/rest/server.go`, `internal/interfaces/rest/entries_test.go`, `cmd/api/main.go`

**Interfaces:**
- Consumes: `entry.IdempotencyGate` (existing), `addentry.GateError` (existing, reused).
- Produces:
  - `entry.KindReversal Kind = "reversal"` constant.
  - Sentinel errors: `entry.ErrNotFound`, `entry.ErrAlreadyReversed`, `entry.ErrNotReversible`.
  - `entry.Reverser` interface: `Reverse(ctx, idempotencyKey uuid.UUID, groupID, originalID, reversalID, requestedBy uuid.UUID) ([]byte, error)` — its own single-method port (not bundled with `Edit`, for the same independent-task-compilability reason `BalanceReader`/`HistoryReader` are split — see Task 1's file-structure note). `entry.Editor` (for `Edit`) is added in Task 4.
  - `(*postgres.Store) Reverse(...)` — one txn: `FOR UPDATE` lock on the original, reversed-already check, insert reversal entry (negated postings, `split_rule = {"type":"reversal"}`, original's `occurred_on`/payer/counterparty/participants/total), mark key succeeded.
  - Unexported `reverseWithinTx(ctx, tx pgx.Tx, groupID, originalID, reversalID, requestedBy uuid.UUID) (int64, error)` — shared with `Edit` in Task 4.
  - `application/correctentry.Service{Gate entry.IdempotencyGate; Reverses entry.Reverser}` with `Reverse(ctx, ReverseCommand) (Result, error)`. Task 4 adds an `Edits entry.Editor` field and an `Edit` method to this same struct.
  - Route `POST /groups/{group_id}/entries/{entry_id}/reverse`, body `{"id":"<client-minted reversal uuid>","requested_by":"<member uuid>"}`, `Idempotency-Key` required. 201/200/409(in-flight)/409(already reversed)/404(not found)/422(kind=reversal)/400.
  - `rest.NewServer(entries *addentry.Service, balances entry.BalanceReader, history entry.HistoryReader, corrections *correctentry.Service) http.Handler` — signature grows by one param.

**Design note on `requested_by`:** v1 has no authenticated caller identity, so the client states who is deleting via `requested_by` (mirroring how POST uses `payer_id` as `created_by`). The `members` FK guarantees it's a real member; per-group authorization joins the auth story, deferred like all v1 auth.

- [ ] **Step 1: Add sentinel errors + `KindReversal` + `Reverser` port**

In `internal/domain/entry/entry.go`, add to the existing `const ( KindExpense ... )` block:

```go
	KindReversal   Kind = "reversal"
```

Add near the existing `ErrDuplicateID`:

```go
// Sentinel errors for the correction path (Reverse/Edit).
var (
	ErrNotFound        = errors.New("entry not found in this group")
	ErrAlreadyReversed = errors.New("entry already reversed")
	ErrNotReversible   = errors.New("reversal entries cannot be reversed")
)
```

Append the port (after `HistoryReader`):

```go
// Reverser persists a reversal — the delete half of the append-only
// correction model. Reverse appends a negated-postings entry referencing
// the original, enforcing "reversed at most once" via a row lock on it.
type Reverser interface {
	Reverse(ctx context.Context, idempotencyKey uuid.UUID, groupID, originalID, reversalID, requestedBy uuid.UUID) ([]byte, error)
}
```

- [ ] **Step 2: Write the failing store tests (Reverse only — Edit's test comes in Task 4)**

`internal/infrastructure/postgres/reversals_test.go`:

```go
package postgres

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
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
```

- [ ] **Step 3: Run to verify failure**

Run: `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test ./internal/infrastructure/postgres/ -v -run TestReverse`
Expected: compile FAIL — `s.Reverse undefined`.

- [ ] **Step 4: Implement `reverseWithinTx` + `Reverse`**

`internal/infrastructure/postgres/reversals.go`:

```go
package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"tallyup/internal/domain/entry"
)

var _ entry.Reverser = (*Store)(nil)

// reverseWithinTx locks the original, rejects double/invalid reversals, and
// appends the reversal entry + negated postings. Caller owns the transaction.
func reverseWithinTx(ctx context.Context, tx pgx.Tx, groupID, originalID, reversalID, requestedBy uuid.UUID) (int64, error) {
	var kind string
	var payer uuid.UUID
	var counterparty *uuid.UUID
	var total int64
	var participants []uuid.UUID
	var occurredOn time.Time
	err := tx.QueryRow(ctx, `
		SELECT kind, payer_id, counterparty, total_amount, participants, occurred_on
		FROM entries WHERE id = $1 AND group_id = $2
		FOR UPDATE`, originalID, groupID).
		Scan(&kind, &payer, &counterparty, &total, &participants, &occurredOn)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, entry.ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if entry.Kind(kind) == entry.KindReversal {
		return 0, entry.ErrNotReversible
	}

	var alreadyReversed bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM entries WHERE reverses_id = $1)`,
		originalID).Scan(&alreadyReversed); err != nil {
		return 0, err
	}
	if alreadyReversed {
		return 0, entry.ErrAlreadyReversed
	}

	var seq int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO entries (id, group_id, kind, reverses_id, payer_id, counterparty,
		                     total_amount, split_rule, participants, occurred_on, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'{"type":"reversal"}',$8,$9,$10)
		RETURNING seq`,
		reversalID, groupID, string(entry.KindReversal), originalID, payer, counterparty, total,
		participants, occurredOn, requestedBy).Scan(&seq); err != nil {
		return 0, err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO postings (entry_id, member_id, amount)
		SELECT $1, member_id, -amount FROM postings WHERE entry_id = $2`,
		reversalID, originalID); err != nil {
		return 0, err
	}
	return seq, nil
}

// Reverse appends a kind='reversal' entry whose postings are the exact
// negation of the original's. FOR UPDATE on the original serializes
// concurrent reversal attempts: the loser re-checks after the winner commits
// and sees the reversal (row locks don't fire the append-only trigger —
// only real UPDATE/DELETE do).
func (s *Store) Reverse(ctx context.Context, key uuid.UUID, groupID, originalID, reversalID, requestedBy uuid.UUID) ([]byte, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	seq, err := reverseWithinTx(ctx, tx, groupID, originalID, reversalID, requestedBy)
	if err != nil {
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

(Task 4 appends `Edit` to this same file, adding a `"tallyup/internal/domain/ledger"` import at that point — don't add it now, it would be unused.)

- [ ] **Step 5: Run store tests**

Run: `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test ./internal/infrastructure/postgres/ -v -race -run TestReverse`
Expected: PASS, including the 10-goroutine race — exactly one reversal wins.

- [ ] **Step 6: Application service**

`internal/application/correctentry/correctentry.go`:

```go
// Package correctentry implements the ledger's append-only correction
// model: reverse (delete) and edit, both as new entries that never mutate
// history. Same idempotency-gate orchestration shape as application/addentry.
package correctentry

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/application/addentry"
	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
)

// ReverseCommand is everything Reverse needs to append a reversal entry.
type ReverseCommand struct {
	GroupID        uuid.UUID
	OriginalID     uuid.UUID
	ReversalID     uuid.UUID
	RequestedBy    uuid.UUID
	IdempotencyKey uuid.UUID
	RequestHash    string
}

// EditCommand is everything Edit needs: the original to reverse plus the
// full replacement entry payload (same shape as addentry.Command).
type EditCommand struct {
	GroupID        uuid.UUID
	OriginalID     uuid.UUID
	ReversalID     uuid.UUID
	ID             uuid.UUID
	Kind           entry.Kind
	PayerID        uuid.UUID
	Counterparty   *uuid.UUID
	TotalAmount    int64
	SplitRule      ledger.SplitRule
	Participants   []uuid.UUID
	Memo           string
	OccurredOn     time.Time
	IdempotencyKey uuid.UUID
	RequestHash    string
}

// Result mirrors addentry.Result: Gate reports whether this call actually
// persisted (GateProceed) or short-circuited on the idempotency gate; Body
// is the response snapshot either way.
type Result struct {
	Gate entry.GateResult
	Body []byte
}

type Service struct {
	Gate     entry.IdempotencyGate
	Reverses entry.Reverser
}

func (s *Service) Reverse(ctx context.Context, cmd ReverseCommand) (Result, error) {
	gate, stored, err := s.Gate.Acquire(ctx, cmd.IdempotencyKey, cmd.RequestHash)
	if err != nil {
		return Result{}, &addentry.GateError{Err: err}
	}
	if gate != entry.GateProceed {
		return Result{Gate: gate, Body: stored}, nil
	}

	resp, err := s.Reverses.Reverse(ctx, cmd.IdempotencyKey, cmd.GroupID, cmd.OriginalID, cmd.ReversalID, cmd.RequestedBy)
	if err != nil {
		if relErr := s.Gate.Release(ctx, cmd.IdempotencyKey); relErr != nil {
			slog.Warn("release idempotency key", "key", cmd.IdempotencyKey, "err", relErr)
		}
		return Result{}, err
	}
	return Result{Gate: entry.GateProceed, Body: resp}, nil
}
```

This compiles and is fully testable standalone: `Service` only declares the `Reverses` field so far, and `EditCommand` is a valid-but-unused type. Task 4 adds an `Edits entry.Editor` field to `Service` and an `Edit` method to this same file.

- [ ] **Step 7: Handler + route**

`internal/interfaces/rest/reversals.go`:

```go
package rest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/google/uuid"

	"tallyup/internal/application/addentry"
	"tallyup/internal/application/correctentry"
	"tallyup/internal/domain/entry"
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
		httpError(w, http.StatusBadRequest, `body must be {"id": "<uuid>", "requested_by": "<member uuid>"}`)
		return
	}

	result, err := s.corrections.Reverse(r.Context(), correctentry.ReverseCommand{
		GroupID: groupID, OriginalID: entryID, ReversalID: req.ID, RequestedBy: req.RequestedBy,
		IdempotencyKey: key, RequestHash: requestHash,
	})

	var gateErr *addentry.GateError
	switch {
	case errors.Is(err, entry.ErrNotFound):
		httpError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, entry.ErrAlreadyReversed):
		httpError(w, http.StatusConflict, err.Error())
	case errors.Is(err, entry.ErrNotReversible):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.As(err, &gateErr):
		httpError(w, http.StatusInternalServerError, "idempotency gate failed")
	case err != nil:
		httpError(w, http.StatusInternalServerError, "reversal failed")
	default:
		switch result.Gate {
		case entry.GateReplay:
			writeJSON(w, http.StatusOK, result.Body)
		case entry.GateInFlight:
			httpError(w, http.StatusConflict, "request in flight; retry shortly")
		case entry.GateMismatch:
			httpError(w, http.StatusUnprocessableEntity, "idempotency key reused with different payload")
		default: // entry.GateProceed
			writeJSON(w, http.StatusCreated, result.Body)
		}
	}
}
```

In `internal/interfaces/rest/server.go`, change the `Server` struct and `NewServer`:

```go
type Server struct {
	entries     *addentry.Service
	balances    entry.BalanceReader
	history     entry.HistoryReader
	corrections *correctentry.Service
}

func NewServer(entries *addentry.Service, balances entry.BalanceReader, history entry.HistoryReader, corrections *correctentry.Service) http.Handler {
	srv := &Server{entries: entries, balances: balances, history: history, corrections: corrections}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /groups/{group_id}/entries", srv.handleCreateEntry)
	mux.HandleFunc("GET /groups/{group_id}/balance", srv.handleGetBalance)
	mux.HandleFunc("GET /groups/{group_id}/entries", srv.handleListEntries)
	mux.HandleFunc("POST /groups/{group_id}/entries/{entry_id}/reverse", srv.handleReverseEntry)
	return mux
}
```

Add the import `"tallyup/internal/application/correctentry"` to `server.go`.

- [ ] **Step 8: Fix the test helper and main.go**

In `internal/interfaces/rest/entries_test.go`:

```go
func newTestServer(t *testing.T) (*httptest.Server, *postgres.Store) {
	s := postgres.TestStore(t)
	seedGroup(t, s)
	entries := &addentry.Service{Gate: s, Entries: s}
	corrections := &correctentry.Service{Gate: s, Reverses: s}
	srv := httptest.NewServer(NewServer(entries, s, s, corrections))
	t.Cleanup(srv.Close)
	return srv, s
}
```

Add the import `"tallyup/internal/application/correctentry"` to `entries_test.go`.

In `cmd/api/main.go`:

```go
	entries := &addentry.Service{Gate: s, Entries: s}
	corrections := &correctentry.Service{Gate: s, Reverses: s}
	srv := &http.Server{Addr: ":" + port, Handler: rest.NewServer(entries, s, s, corrections)}
```

Add the import `"tallyup/internal/application/correctentry"` to `main.go`.

- [ ] **Step 9: Write the failing handler tests**

`internal/interfaces/rest/reversals_test.go`:

```go
package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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

- [ ] **Step 10: Run everything, commit**

Run: `go build ./... && TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test -p 1 ./... -race`
Expected: PASS.

```bash
git add internal/domain/entry/entry.go internal/application/correctentry/correctentry.go internal/infrastructure/postgres/reversals.go internal/infrastructure/postgres/reversals_test.go internal/interfaces/rest/reversals.go internal/interfaces/rest/reversals_test.go internal/interfaces/rest/server.go internal/interfaces/rest/entries_test.go cmd/api/main.go
git commit -m "feat: entry reversal with row-lock against double-reversal"
```

---

### Task 4: Edit an entry — `domain/entry.Editor` + `PUT /groups/{group_id}/entries/{entry_id}`

**Files:**
- Modify: `internal/domain/entry/entry.go`, `internal/application/addentry/addentry.go`, `internal/application/correctentry/correctentry.go`, `internal/infrastructure/postgres/entry_repository.go`, `internal/infrastructure/postgres/reversals.go`, `internal/infrastructure/postgres/reversals_test.go`, `internal/interfaces/rest/entries.go`, `internal/interfaces/rest/reversals.go`, `internal/interfaces/rest/server.go`

**Interfaces:**
- Consumes: `reverseWithinTx` (Task 3), `ledger.ComputePostings`/`ledger.SettlementPostings`.
- Produces:
  - `entry.Editor` interface: `Edit(ctx, idempotencyKey uuid.UUID, groupID, originalID, reversalID uuid.UUID, in Input, postings []ledger.Posting) ([]byte, error)` — the `Edit` counterpart to Task 3's `Reverser`.
  - `addentry.ComputePostings(cmd Command) (postings []ledger.Posting, splitJSON []byte, participants []uuid.UUID, err error)` — exported (was unexported `computePostings`), reused by `correctentry.Service.Edit`.
  - Unexported `insertEntryWithinTx(ctx, tx pgx.Tx, in entry.Input, postings []ledger.Posting) (int64, error)` and `assertZeroSum(postings []ledger.Posting) error` in `infrastructure/postgres`, extracted from `Create`.
  - `(*postgres.Store) Edit(ctx, key uuid.UUID, groupID, originalID, reversalID uuid.UUID, in entry.Input, postings []ledger.Posting) ([]byte, error)` — ONE transaction: reverse the original (`reverseWithinTx`), then `insertEntryWithinTx` the replacement, then mark the key.
  - `correctentry.Service` grows an `Edits entry.Editor` field and an `Edit(ctx, EditCommand) (Result, error)` method.
  - Route `PUT /groups/{group_id}/entries/{entry_id}` — body is the create payload plus `"reversal_id": "<uuid>"`.
  - `internal/interfaces/rest/entries.go`'s `createEntryRequest` gains a `ReversalID` field, reused by the edit handler.
- **No duplicated SQL** between `Create`, `Reverse`, and `Edit` — `Create`/`Edit` both call `insertEntryWithinTx`; `Reverse`/`Edit` both call `reverseWithinTx`.
- `rest.NewServer`'s signature does **not** change in this task — `corrections *correctentry.Service` already covers `Edit`, since it's the same `*Service` value with a new method.

- [ ] **Step 1: Add the `Editor` port**

In `internal/domain/entry/entry.go`, append (after `Reverser`):

```go
// Editor persists an edit — reversal + replacement in one transaction, the
// other half of the append-only correction model alongside Reverser.
type Editor interface {
	Edit(ctx context.Context, idempotencyKey uuid.UUID, groupID, originalID, reversalID uuid.UUID, in Input, postings []ledger.Posting) ([]byte, error)
}
```

- [ ] **Step 2: Export `addentry.ComputePostings`**

In `internal/application/addentry/addentry.go`, rename `computePostings` to `ComputePostings` (function signature unchanged) and update its one call site inside `AddEntry`:

```go
	postings, splitJSON, participants, err := ComputePostings(cmd)
```

Run: `go build ./...` — expect PASS (pure rename, no behavior change).

- [ ] **Step 3: Write the failing store test**

Append to `internal/infrastructure/postgres/reversals_test.go`:

```go
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
	want := []entry.MemberBalance{{rYuto, 4500}, {rMemA, -4500}, {rMemB, 0}}
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
```

Add imports `"time"` and `"tallyup/internal/domain/ledger"` to `internal/infrastructure/postgres/reversals_test.go`.

- [ ] **Step 4: Run to verify failure**

Run: `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test ./internal/infrastructure/postgres/ -v -run TestEdit`
Expected: compile FAIL — `s.Edit undefined`.

- [ ] **Step 5: Extract `insertEntryWithinTx` + `assertZeroSum` from `Create`**

Replace all of `internal/infrastructure/postgres/entry_repository.go` with:

```go
package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/group"
	"tallyup/internal/domain/ledger"
)

var _ entry.Repository = (*Store)(nil)

func assertZeroSum(postings []ledger.Posting) error {
	var sum int64
	for _, p := range postings {
		sum += p.Amount
	}
	if sum != 0 {
		return fmt.Errorf("postings sum to %d, refusing to write", sum)
	}
	return nil
}

// insertEntryWithinTx validates membership and appends one entry with its
// postings. Caller owns the transaction and has already zero-sum-checked.
func insertEntryWithinTx(ctx context.Context, tx pgx.Tx, in entry.Input, postings []ledger.Posting) (int64, error) {
	// Everyone touched by this entry must belong to the group.
	touched := append([]uuid.UUID{in.PayerID}, in.Participants...)
	if in.Counterparty != nil {
		touched = append(touched, *in.Counterparty)
	}
	uniq := make(map[uuid.UUID]bool, len(touched))
	ids := touched[:0]
	for _, m := range touched {
		if !uniq[m] {
			uniq[m] = true
			ids = append(ids, m)
		}
	}
	var cnt int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM group_members WHERE group_id=$1 AND member_id = ANY($2)`,
		in.GroupID, ids).Scan(&cnt); err != nil {
		return 0, err
	}
	if cnt != len(ids) {
		return 0, group.ErrNotMember
	}

	var seq int64
	err := tx.QueryRow(ctx, `
		INSERT INTO entries (id, group_id, kind, payer_id, counterparty, total_amount,
		                     split_rule, participants, memo, occurred_on, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING seq`,
		in.ID, in.GroupID, in.Kind, in.PayerID, in.Counterparty, in.TotalAmount,
		in.SplitRule, in.Participants, in.Memo, in.OccurredOn, in.CreatedBy).Scan(&seq)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
		return 0, entry.ErrDuplicateID
	}
	if err != nil {
		return 0, err
	}

	for _, p := range postings {
		if _, err := tx.Exec(ctx,
			`INSERT INTO postings (entry_id, member_id, amount) VALUES ($1,$2,$3)`,
			in.ID, p.MemberID, p.Amount); err != nil {
			return 0, err
		}
	}
	return seq, nil
}

// Create runs the write path's single transaction: membership check, entry
// + postings insert, and marking the idempotency key succeeded with the
// response snapshot. postings must already sum to zero (asserted here too).
func (s *Store) Create(ctx context.Context, key uuid.UUID, in entry.Input, postings []ledger.Posting) ([]byte, error) {
	if err := assertZeroSum(postings); err != nil {
		return nil, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	seq, err := insertEntryWithinTx(ctx, tx, in, postings)
	if err != nil {
		return nil, err
	}

	// RETURNING gives us the JSONB-normalized bytes, so this first response is
	// byte-identical to every future replay read from the same column.
	snapshot := []byte(fmt.Sprintf(`{"id":%q,"seq":%d}`, in.ID, seq))
	var resp []byte
	if err := tx.QueryRow(ctx,
		`UPDATE idempotency_keys SET status='succeeded', response_body=$2 WHERE key=$1
		 RETURNING response_body`,
		key, snapshot).Scan(&resp); err != nil {
		return nil, err
	}
	return resp, tx.Commit(ctx)
}
```

- [ ] **Step 6: Run existing tests to confirm the refactor is behavior-preserving**

Run: `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test -p 1 ./... -race`
Expected: PASS (everything from Tasks 1–3 still green).

- [ ] **Step 7: Implement `Edit`**

In `internal/infrastructure/postgres/reversals.go`, add `"tallyup/internal/domain/ledger"` to the import block, then append:

```go
var _ entry.Editor = (*Store)(nil)

// Edit = reversal + replacement in one transaction (architecture.md §3):
// either both land or neither does.
func (s *Store) Edit(ctx context.Context, key uuid.UUID, groupID, originalID, reversalID uuid.UUID, in entry.Input, postings []ledger.Posting) ([]byte, error) {
	if err := assertZeroSum(postings); err != nil {
		return nil, err
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

- [ ] **Step 8: Run store tests**

Run: `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test ./internal/infrastructure/postgres/ -v -race`
Expected: PASS (new `TestEdit_ReverseAndReplaceAtomically` + everything prior).

- [ ] **Step 9: Application service `Edit`**

In `internal/application/correctentry/correctentry.go`, add the `Edits` field to `Service`:

```go
type Service struct {
	Gate     entry.IdempotencyGate
	Reverses entry.Reverser
	Edits    entry.Editor
}
```

Then append the method:

```go
func (s *Service) Edit(ctx context.Context, cmd EditCommand) (Result, error) {
	postings, splitJSON, participants, err := addentry.ComputePostings(addentry.Command{
		Kind: cmd.Kind, PayerID: cmd.PayerID, Counterparty: cmd.Counterparty,
		TotalAmount: cmd.TotalAmount, SplitRule: cmd.SplitRule, Participants: cmd.Participants,
	})
	if err != nil {
		return Result{}, err
	}

	gate, stored, err := s.Gate.Acquire(ctx, cmd.IdempotencyKey, cmd.RequestHash)
	if err != nil {
		return Result{}, &addentry.GateError{Err: err}
	}
	if gate != entry.GateProceed {
		return Result{Gate: gate, Body: stored}, nil
	}

	resp, err := s.Edits.Edit(ctx, cmd.IdempotencyKey, cmd.GroupID, cmd.OriginalID, cmd.ReversalID, entry.Input{
		ID: cmd.ID, GroupID: cmd.GroupID, Kind: cmd.Kind, PayerID: cmd.PayerID,
		Counterparty: cmd.Counterparty, TotalAmount: cmd.TotalAmount,
		SplitRule: splitJSON, Participants: participants, Memo: cmd.Memo,
		OccurredOn: cmd.OccurredOn, CreatedBy: cmd.PayerID,
	}, postings)
	if err != nil {
		if relErr := s.Gate.Release(ctx, cmd.IdempotencyKey); relErr != nil {
			slog.Warn("release idempotency key", "key", cmd.IdempotencyKey, "err", relErr)
		}
		return Result{}, err
	}
	return Result{Gate: entry.GateProceed, Body: resp}, nil
}
```

- [ ] **Step 10: Widen `createEntryRequest`, write the handler test, implement the handler, add the route**

In `internal/interfaces/rest/entries.go`, add one field to `createEntryRequest`:

```go
type createEntryRequest struct {
	ID           uuid.UUID        `json:"id"`
	Kind         entry.Kind       `json:"kind"`
	PayerID      uuid.UUID        `json:"payer_id"`
	Counterparty *uuid.UUID       `json:"counterparty,omitempty"`
	TotalAmount  int64            `json:"total_amount"`
	SplitRule    ledger.SplitRule `json:"split_rule"`
	Participants []uuid.UUID      `json:"participants"`
	Memo         string           `json:"memo,omitempty"`
	OccurredOn   string           `json:"occurred_on"` // YYYY-MM-DD
	ReversalID   uuid.UUID        `json:"reversal_id,omitempty"` // PUT (edit) only
}
```

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

Run to verify failure: `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test ./internal/interfaces/rest/ -v -run TestEdit`
Expected: compile FAIL — `s.handleEditEntry undefined` (route not registered / handler missing).

Append to `internal/interfaces/rest/reversals.go` (add imports `"time"` and `"tallyup/internal/domain/group"`):

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
	occurredOn, err := time.Parse("2006-01-02", req.OccurredOn)
	if err != nil {
		httpError(w, http.StatusBadRequest, "occurred_on must be YYYY-MM-DD")
		return
	}

	result, err := s.corrections.Edit(r.Context(), correctentry.EditCommand{
		GroupID: groupID, OriginalID: originalID, ReversalID: req.ReversalID,
		ID: req.ID, Kind: req.Kind, PayerID: req.PayerID, Counterparty: req.Counterparty,
		TotalAmount: req.TotalAmount, SplitRule: req.SplitRule, Participants: req.Participants,
		Memo: req.Memo, OccurredOn: occurredOn,
		IdempotencyKey: key, RequestHash: requestHash,
	})

	var valErr *addentry.ValidationError
	var gateErr *addentry.GateError
	switch {
	case errors.Is(err, addentry.ErrCounterpartyRequired):
		httpError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, addentry.ErrUnknownKind):
		httpError(w, http.StatusBadRequest, err.Error())
	case errors.As(err, &valErr):
		httpError(w, http.StatusUnprocessableEntity, valErr.Error())
	case errors.Is(err, entry.ErrNotFound):
		httpError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, entry.ErrAlreadyReversed):
		httpError(w, http.StatusConflict, err.Error())
	case errors.Is(err, entry.ErrNotReversible):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, group.ErrNotMember):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, entry.ErrDuplicateID):
		httpError(w, http.StatusConflict, err.Error())
	case errors.As(err, &gateErr):
		httpError(w, http.StatusInternalServerError, "idempotency gate failed")
	case err != nil:
		httpError(w, http.StatusInternalServerError, "edit failed")
	default:
		switch result.Gate {
		case entry.GateReplay:
			writeJSON(w, http.StatusOK, result.Body)
		case entry.GateInFlight:
			httpError(w, http.StatusConflict, "request in flight; retry shortly")
		case entry.GateMismatch:
			httpError(w, http.StatusUnprocessableEntity, "idempotency key reused with different payload")
		default:
			writeJSON(w, http.StatusCreated, result.Body)
		}
	}
}
```

In `internal/interfaces/rest/server.go`, add the route:

```go
	mux.HandleFunc("PUT /groups/{group_id}/entries/{entry_id}", srv.handleEditEntry)
```

- [ ] **Step 11: Run everything, commit**

Run: `go build ./... && TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test -p 1 ./... -race`
Expected: PASS.

```bash
git add internal/domain/entry/entry.go internal/application/addentry/addentry.go internal/application/correctentry/correctentry.go internal/infrastructure/postgres/entry_repository.go internal/infrastructure/postgres/reversals.go internal/infrastructure/postgres/reversals_test.go internal/interfaces/rest/entries.go internal/interfaces/rest/reversals.go internal/interfaces/rest/reversals_test.go internal/interfaces/rest/server.go
git commit -m "feat: atomic edit as reversal plus replacement entry"
```

---

### Task 5: Integrity checks — `Store.CheckIntegrity`

**Files:**
- Create: `internal/infrastructure/postgres/integrity.go`, `internal/infrastructure/postgres/integrity_test.go`

**Interfaces:**
- Produces:
  - `postgres.IntegrityReport{GlobalSum int64; EntriesWithNonzeroSum int; DoublyReversedOriginals int}` with method `(IntegrityReport) OK() bool` (true iff all three are zero). No domain port — like `SweepStalePending`, this is infra-only tooling for the chaos-test phase and a future admin endpoint/cron, not something any current caller needs to swap out.
  - `(*Store) CheckIntegrity(ctx context.Context) (IntegrityReport, error)` — the three checks from `architecture.md` §5: global zero-sum, per-entry zero-sum, at-most-one reversal per original.

- [ ] **Step 1: Write the failing tests**

`internal/infrastructure/postgres/integrity_test.go`:

```go
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
```

*(A dirty-ledger test for `CheckIntegrity` would require corrupting append-only tables, which the trigger correctly prevents — the checks' SQL is exercised for the counting-zero path here; the chaos phase re-runs them after real concurrent load.)*

- [ ] **Step 2: Run to verify failure**

Run: `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test ./internal/infrastructure/postgres/ -v -run CheckIntegrity`
Expected: compile FAIL — `s.CheckIntegrity undefined`.

- [ ] **Step 3: Implement**

`internal/infrastructure/postgres/integrity.go`:

```go
package postgres

import "context"

// IntegrityReport is the result of the architecture.md §5 integrity checks.
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

Run: `go build ./... && go vet ./... && TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test -p 1 ./... -race`
Expected: PASS.

```bash
git add internal/infrastructure/postgres/integrity.go internal/infrastructure/postgres/integrity_test.go
git commit -m "feat: ledger integrity checks"
```

---

## Deferred / notes for later plans

- `GET /groups/{id}/balance` and the history endpoint do not 404 on unknown groups (they return empty results) — acceptable until the auth/groups work gives groups a real existence check.
- The settle-up plan consumes `entry.BalanceSnapshot.AsOfSeq` as its optimistic-concurrency token.
- SSE upgrade of the history poll is v1.1.
- After this plan lands, open a PR against `main` for issue #5 (`gh pr create`), referencing the issue and summarizing the five tasks.
