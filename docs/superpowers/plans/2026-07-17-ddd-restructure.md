# Structural DDD Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure tally-up's Go backend from flat layered packages (`internal/ledger`, `internal/store`, `internal/api`) into structural DDD (`domain/`, `application/`, `infrastructure/`, `interfaces/`), with zero behavior change, closing GitHub issue #59.

**Architecture:** `interfaces/rest` → `application/addentry` → `domain/{entry,group,ledger}` interfaces ← implemented by `infrastructure/postgres`. `cmd/api` is the only place that constructs the Postgres implementation and wires it into the application service. Nothing outside `infrastructure/postgres` and `cmd/api` imports `pgx` or knows Postgres exists (test files that build integration fixtures are the one legitimate exception — see Global Constraints).

**Tech Stack:** Go, `pgx/v5`, `golang-migrate`, `github.com/google/uuid`, `pgregory.net/rapid` (existing deps, unchanged).

## Global Constraints

- **Zero behavior change.** Every HTTP status code, response body, and error message stays byte-identical to today. Every existing test passes unmodified in substance (import paths and receiver types may change; assertions and fixtures do not).
- **No new architecture beyond the issue's scope.** No aggregates, no domain events, no factories. Postgres (the append-only trigger, `entries`/`postings` checks, unique constraints) remains the invariant enforcer, exactly as today.
- **`entry.Repository.Create` stays the single atomic Postgres transaction** (membership check + entry insert + postings insert + idempotency-succeed), exactly matching today's `store.CreateEntry`. `domain/group.MembershipChecker` is a real port with a real Postgres implementation, but it is **not** wired into `application/addentry` in this PR — wiring it in would add a DB round-trip and a TOCTOU window that doesn't exist today. It exists for Phase 3 (reads/reversals, member management) to consume later. *(Confirmed with the user before writing this plan — see the two-option tradeoff in conversation history.)*
- **Test files may import concrete adapters.** The "interfaces/rest and application have zero imports of infrastructure" rule (from the issue's acceptance criteria) applies to non-test production code. `*_test.go` files that build an end-to-end integration fixture (real Postgres → real service → real HTTP handler) legitimately import `infrastructure/postgres` and `application/addentry`, exactly as `internal/api/entries_test.go` imports `internal/store` today.
- **Two-copy migrations pattern is preserved.** Top-level `migrations/*.sql` stays the source of truth; the embedded copy moves from `internal/store/migrations/` to `internal/infrastructure/postgres/migrations/`.
- **`go build ./...`** must succeed and **`make test`** must pass after Task 5 and every task after it. Tasks 1–2 are additive/isolated and Task 3 deliberately leaves `internal/api`/`cmd/api` non-compiling until Task 5 rewires them — each of those tasks is verified with a scoped `go build`/`go test` on just the packages it touches, not the whole module.
- **macOS toolchain note:** use `CGO_ENABLED=0 go ...` for any `go build`/`go test`/`go vet` run outside `make`, matching the Makefile's existing workaround.

---

## File Structure (final state)

```
internal/
  domain/
    ledger/                  # moved verbatim from internal/ledger
      ledger.go
      split.go
      property_test.go
      split_test.go
    entry/
      entry.go                # Input, Repository, IdempotencyGate, GateResult, ErrDuplicateID
    group/
      group.go                 # ErrNotMember, MembershipChecker
  application/
    addentry/
      addentry.go               # Service, Command, Result, AddEntry, ValidationError
  infrastructure/
    postgres/
      store.go                  # moved from internal/store/store.go (package rename only)
      entry_repository.go        # moved+rewritten from internal/store/entries.go
      idempotency.go              # moved+rewritten from internal/store/idempotency.go
      membership.go                 # new: AllMembers (group.MembershipChecker)
      store_test.go                  # moved from internal/store/store_test.go
      idempotency_test.go             # moved+rewritten from internal/store/idempotency_test.go
      migrations/
        0001_init.up.sql              # moved from internal/store/migrations/
        0001_init.down.sql
  interfaces/
    rest/
      server.go                # moved+rewritten from internal/api/server.go
      entries.go                 # moved+rewritten from internal/api/entries.go
      entries_test.go              # moved+rewritten from internal/api/entries_test.go
cmd/api/
  main.go                     # modified: new wiring
```

`internal/ledger`, `internal/store`, `internal/api` are deleted once their contents have moved.

---

### Task 1: Move `internal/ledger` → `internal/domain/ledger`

**Files:**
- Move: `internal/ledger/ledger.go` → `internal/domain/ledger/ledger.go` (no content change)
- Move: `internal/ledger/split.go` → `internal/domain/ledger/split.go` (no content change)
- Move: `internal/ledger/property_test.go` → `internal/domain/ledger/property_test.go` (no content change)
- Move: `internal/ledger/split_test.go` → `internal/domain/ledger/split_test.go` (no content change)
- Modify: `internal/store/entries.go:12` (import path only)
- Modify: `internal/api/entries.go:15` (import path only)
- Modify: `internal/api/entries_test.go:15` (import path only — also imports `ledger.SplitRule`/`ledger.SplitShares` for `TestCreateExpense_WeightedSharesRoundTrip`)

**Interfaces:**
- Produces: `tallyup/internal/domain/ledger` exporting `SplitRule`, `SplitType`, `Posting`, `MaxAmount`, `ComputePostings`, `SettlementPostings` — identical API to today's `tallyup/internal/ledger`.

- [ ] **Step 1: Move the package**

```bash
mkdir -p internal/domain
git mv internal/ledger internal/domain/ledger
```

None of `ledger.go`, `split.go`, `property_test.go`, `split_test.go` import their own package by path, so no content edits are needed — `package ledger` stays correct at the new location.

- [ ] **Step 2: Update the three existing importers' import paths**

In `internal/store/entries.go`, change:

```go
	"tallyup/internal/ledger"
```

to:

```go
	"tallyup/internal/domain/ledger"
```

In `internal/api/entries.go`, change:

```go
	"tallyup/internal/ledger"
```

to:

```go
	"tallyup/internal/domain/ledger"
```

In `internal/api/entries_test.go`, change:

```go
	"tallyup/internal/ledger"
```

to:

```go
	"tallyup/internal/domain/ledger"
```

This third file is easy to miss — `go build ./...` alone won't catch it (Go doesn't compile `_test.go` files under plain `go build`); only `go vet ./...` or `go test ./...` will. Verify with both, not just `go build`.

- [ ] **Step 3: Verify**

```bash
CGO_ENABLED=0 go build ./...
CGO_ENABLED=0 go vet ./...
CGO_ENABLED=0 go test ./internal/domain/ledger/... -v
```

Expected: build and vet succeed (vet catches any stray old-path import that `go build` alone would miss, e.g. in a `_test.go` file); all `ledger` package tests (including the `rapid` property tests) pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add internal/domain/ledger internal/store/entries.go internal/api/entries.go
git commit -m "refactor: move internal/ledger to internal/domain/ledger"
```

---

### Task 2: Create `domain/entry` and `domain/group`

**Files:**
- Create: `internal/domain/entry/entry.go`
- Create: `internal/domain/group/group.go`

**Interfaces:**
- Consumes: `tallyup/internal/domain/ledger.Posting` (from Task 1)
- Produces:
  - `entry.Input`, `entry.Repository` (method `Create(ctx, idempotencyKey uuid.UUID, in Input, postings []ledger.Posting) ([]byte, error)`)
  - `entry.IdempotencyGate` (methods `Acquire(ctx, key uuid.UUID, requestHash string) (GateResult, []byte, error)`, `Release(ctx, key uuid.UUID) error`)
  - `entry.GateResult` + consts `GateProceed`, `GateReplay`, `GateInFlight`, `GateMismatch`
  - `entry.ErrDuplicateID`
  - `group.ErrNotMember`, `group.MembershipChecker` (method `AllMembers(ctx, groupID uuid.UUID, memberIDs []uuid.UUID) (bool, error)`)
- These are pure interface/type definitions — nothing implements them yet (that's Task 3). The module still builds because unimplemented/unused interfaces are valid Go.

- [ ] **Step 1: Write `internal/domain/entry/entry.go`**

```go
// Package entry defines the write path's entry-creation port: the request
// shape the application layer builds, and the repository/idempotency-gate
// contracts infrastructure/postgres implements to persist it.
package entry

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/domain/ledger"
)

// ErrDuplicateID means an entry with this client-generated id already exists.
var ErrDuplicateID = errors.New("entry id already exists")

// Input is everything Repository.Create needs to persist one entry and its
// postings.
type Input struct {
	ID           uuid.UUID
	GroupID      uuid.UUID
	Kind         string
	PayerID      uuid.UUID
	Counterparty *uuid.UUID
	TotalAmount  int64
	SplitRule    []byte // raw JSON, stored verbatim
	Participants []uuid.UUID
	Memo         string
	OccurredOn   time.Time
	CreatedBy    uuid.UUID
}

// Repository persists a fully computed entry and its postings, atomically
// marking the owning idempotency key succeeded with the response snapshot.
// The Postgres implementation validates group membership inside the same
// transaction as the insert (see domain/group), so this single call is the
// entire atomic unit of work — callers never split it across two round
// trips.
type Repository interface {
	Create(ctx context.Context, idempotencyKey uuid.UUID, in Input, postings []ledger.Posting) ([]byte, error)
}

// GateResult is the outcome of an idempotency-gate acquisition attempt.
type GateResult int

const (
	GateProceed  GateResult = iota // this request owns the operation
	GateReplay                     // already succeeded; caller should return the stored body
	GateInFlight                   // another request holds a pending row
	GateMismatch                   // same key, different payload — client bug
)

// IdempotencyGate implements the pending-row-first gate from
// architecture.md §4.
type IdempotencyGate interface {
	Acquire(ctx context.Context, key uuid.UUID, requestHash string) (GateResult, []byte, error)
	Release(ctx context.Context, key uuid.UUID) error
}
```

- [ ] **Step 2: Write `internal/domain/group/group.go`**

```go
// Package group defines the write path's group-membership port.
package group

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNotMember means one or more referenced members are not part of the group.
var ErrNotMember = errors.New("payer, counterparty, and participants must all be group members")

// MembershipChecker verifies that every given member id belongs to the
// group. infrastructure/postgres's entry.Repository implementation enforces
// this itself, inside the same transaction as the entry insert — this port
// exists for callers that need a standalone check outside that transaction
// (e.g. future read-path and member-management use cases).
type MembershipChecker interface {
	AllMembers(ctx context.Context, groupID uuid.UUID, memberIDs []uuid.UUID) (bool, error)
}
```

- [ ] **Step 3: Verify**

```bash
CGO_ENABLED=0 go build ./internal/domain/...
CGO_ENABLED=0 go vet ./internal/domain/...
```

Expected: both succeed (new packages compile; nothing references them yet, which is fine).

- [ ] **Step 4: Commit**

```bash
git add internal/domain/entry internal/domain/group
git commit -m "feat: define domain/entry and domain/group write-path ports"
```

---

### Task 3: Move `internal/store` → `internal/infrastructure/postgres`, implementing the new ports

**Files:**
- Move: `internal/store/store.go` → `internal/infrastructure/postgres/store.go` (package rename only)
- Move+rewrite: `internal/store/entries.go` → `internal/infrastructure/postgres/entry_repository.go`
- Move+rewrite: `internal/store/idempotency.go` → `internal/infrastructure/postgres/idempotency.go`
- Create: `internal/infrastructure/postgres/membership.go`
- Move: `internal/store/store_test.go` → `internal/infrastructure/postgres/store_test.go` (package rename only)
- Move+rewrite: `internal/store/idempotency_test.go` → `internal/infrastructure/postgres/idempotency_test.go`
- Move: `internal/store/migrations/0001_init.up.sql` → `internal/infrastructure/postgres/migrations/0001_init.up.sql`
- Move: `internal/store/migrations/0001_init.down.sql` → `internal/infrastructure/postgres/migrations/0001_init.down.sql`
- Delete: `internal/store/` (empty after the moves above)

**Interfaces:**
- Consumes: `entry.Input`, `entry.Repository`, `entry.IdempotencyGate`, `entry.GateResult`+consts, `entry.ErrDuplicateID`, `group.ErrNotMember`, `group.MembershipChecker` (Task 2); `ledger.Posting` (Task 1)
- Produces: `postgres.Store` satisfying `entry.Repository`, `entry.IdempotencyGate`, and `group.MembershipChecker`; `postgres.New`, `postgres.Migrate`, `postgres.TestStore` (same signatures as today's `store.New`/`store.Migrate`/`store.TestStore`); `postgres.Store.SweepStalePending` (unchanged signature, used directly by `cmd/api`'s janitor goroutine).

- [ ] **Step 1: Move the directory and rename the package**

```bash
mkdir -p internal/infrastructure
git mv internal/store internal/infrastructure/postgres
git mv internal/infrastructure/postgres/entries.go internal/infrastructure/postgres/entry_repository.go
```

- [ ] **Step 2: Rewrite `internal/infrastructure/postgres/store.go`**

Only the package clause and doc comment change; everything else is byte-identical to today's `internal/store/store.go`:

```go
// Package postgres implements tally-up's domain repository and port
// interfaces against Postgres. It owns all pgx access, schema migrations,
// and the idempotency gate; nothing outside this package knows Postgres
// exists.
package postgres

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type Store struct {
	Pool *pgxpool.Pool
}

// New connects, runs pending migrations, and returns the store.
func New(ctx context.Context, databaseURL string) (*Store, error) {
	if err := Migrate(databaseURL); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &Store{Pool: pool}, nil
}

func Migrate(databaseURL string) error {
	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return err
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, databaseURL)
	if err != nil {
		return err
	}
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}

// TestStore returns a migrated store against TEST_DATABASE_URL with all
// tables truncated, or skips the test when the env var is unset.
func TestStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; run `docker compose up -d db` and export it")
	}
	s, err := New(context.Background(), url)
	if err != nil {
		t.Fatalf("TestStore: %v", err)
	}
	t.Cleanup(s.Pool.Close)
	_, err = s.Pool.Exec(context.Background(),
		`TRUNCATE postings, entries, group_members, groups, members, idempotency_keys CASCADE`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return s
}
```

- [ ] **Step 3: Rewrite `internal/infrastructure/postgres/entry_repository.go`**

```go
package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/group"
	"tallyup/internal/domain/ledger"
)

var _ entry.Repository = (*Store)(nil)

// Create runs the write path's single transaction: membership check, entry
// + postings insert, and marking the idempotency key succeeded with the
// response snapshot. postings must already sum to zero (asserted here too).
func (s *Store) Create(ctx context.Context, key uuid.UUID, in entry.Input, postings []ledger.Posting) ([]byte, error) {
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
		return nil, err
	}
	if cnt != len(ids) {
		return nil, group.ErrNotMember
	}

	var seq int64
	err = tx.QueryRow(ctx, `
		INSERT INTO entries (id, group_id, kind, payer_id, counterparty, total_amount,
		                     split_rule, participants, memo, occurred_on, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING seq`,
		in.ID, in.GroupID, in.Kind, in.PayerID, in.Counterparty, in.TotalAmount,
		in.SplitRule, in.Participants, in.Memo, in.OccurredOn, in.CreatedBy).Scan(&seq)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
		return nil, entry.ErrDuplicateID
	}
	if err != nil {
		return nil, err
	}

	for _, p := range postings {
		if _, err := tx.Exec(ctx,
			`INSERT INTO postings (entry_id, member_id, amount) VALUES ($1,$2,$3)`,
			in.ID, p.MemberID, p.Amount); err != nil {
			return nil, err
		}
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

- [ ] **Step 4: Write `internal/infrastructure/postgres/membership.go`**

```go
package postgres

import (
	"context"

	"github.com/google/uuid"

	"tallyup/internal/domain/group"
)

var _ group.MembershipChecker = (*Store)(nil)

// AllMembers reports whether every id in memberIDs belongs to groupID. It is
// a standalone (non-transactional) check for callers outside the entry
// write path, which enforces membership itself inside its own transaction.
func (s *Store) AllMembers(ctx context.Context, groupID uuid.UUID, memberIDs []uuid.UUID) (bool, error) {
	uniq := make(map[uuid.UUID]bool, len(memberIDs))
	ids := make([]uuid.UUID, 0, len(memberIDs))
	for _, m := range memberIDs {
		if !uniq[m] {
			uniq[m] = true
			ids = append(ids, m)
		}
	}
	var cnt int
	if err := s.Pool.QueryRow(ctx,
		`SELECT count(*) FROM group_members WHERE group_id=$1 AND member_id = ANY($2)`,
		groupID, ids).Scan(&cnt); err != nil {
		return false, err
	}
	return cnt == len(ids), nil
}
```

- [ ] **Step 5: Rewrite `internal/infrastructure/postgres/idempotency.go`**

```go
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"tallyup/internal/domain/entry"
)

var _ entry.IdempotencyGate = (*Store)(nil)

// Acquire implements the pending-row-first gate from architecture.md §4.
// The pending insert commits immediately (its own implicit txn) so a crash
// leaves a visible pending row for the janitor.
func (s *Store) Acquire(ctx context.Context, key uuid.UUID, requestHash string) (entry.GateResult, []byte, error) {
	ct, err := s.Pool.Exec(ctx,
		`INSERT INTO idempotency_keys (key, request_hash, status) VALUES ($1, $2, 'pending')
		 ON CONFLICT (key) DO NOTHING`, key, requestHash)
	if err != nil {
		return 0, nil, err
	}
	if ct.RowsAffected() == 1 {
		return entry.GateProceed, nil, nil
	}

	var storedHash, status string
	var body []byte
	err = s.Pool.QueryRow(ctx,
		`SELECT request_hash, status, COALESCE(response_body, 'null'::jsonb)
		 FROM idempotency_keys WHERE key = $1`, key).Scan(&storedHash, &status, &body)
	if errors.Is(err, pgx.ErrNoRows) {
		// Janitor deleted the row between our insert-conflict and this read;
		// tell the client to retry rather than racing to re-own it here.
		return entry.GateInFlight, nil, nil
	}
	if err != nil {
		return 0, nil, err
	}
	if storedHash != requestHash {
		return entry.GateMismatch, nil, nil
	}
	if status == "succeeded" {
		return entry.GateReplay, body, nil
	}
	return entry.GateInFlight, nil, nil
}

// Release frees a pending key after a post-gate failure so the client can
// retry immediately instead of waiting for the janitor. Succeeded keys are
// never released: their response snapshot is the replay truth.
func (s *Store) Release(ctx context.Context, key uuid.UUID) error {
	_, err := s.Pool.Exec(ctx,
		`DELETE FROM idempotency_keys WHERE key = $1 AND status = 'pending'`, key)
	return err
}

// SweepStalePending deletes pending rows older than olderThan so crashed
// requests can be retried cleanly.
func (s *Store) SweepStalePending(ctx context.Context, olderThan time.Duration) (int64, error) {
	ct, err := s.Pool.Exec(ctx,
		`DELETE FROM idempotency_keys
		 WHERE status = 'pending' AND created_at < now() - make_interval(secs => $1)`,
		olderThan.Seconds())
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}
```

- [ ] **Step 6: Update `internal/infrastructure/postgres/store_test.go`**

Only the package clause changes (`package store` → `package postgres`); every test body, query, and assertion stays identical to today's `internal/store/store_test.go`.

- [ ] **Step 7: Rewrite `internal/infrastructure/postgres/idempotency_test.go`**

```go
package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
)

func TestGate_FreshKeyProceeds(t *testing.T) {
	s := TestStore(t)
	res, _, err := s.Acquire(context.Background(), uuid.New(), "hash1")
	if err != nil {
		t.Fatal(err)
	}
	if res != entry.GateProceed {
		t.Fatalf("got %v, want GateProceed", res)
	}
}

func TestGate_DuplicatePendingIsInFlight(t *testing.T) {
	s := TestStore(t)
	key := uuid.New()
	ctx := context.Background()
	s.Acquire(ctx, key, "hash1")
	res, _, err := s.Acquire(ctx, key, "hash1")
	if err != nil {
		t.Fatal(err)
	}
	if res != entry.GateInFlight {
		t.Fatalf("got %v, want GateInFlight", res)
	}
}

func TestGate_SucceededKeyReplaysStoredResponse(t *testing.T) {
	s := TestStore(t)
	key := uuid.New()
	ctx := context.Background()
	s.Acquire(ctx, key, "hash1")
	_, err := s.Pool.Exec(ctx,
		`UPDATE idempotency_keys SET status='succeeded', response_body='{"id":"x","seq":1}' WHERE key=$1`, key)
	if err != nil {
		t.Fatal(err)
	}
	res, body, err := s.Acquire(ctx, key, "hash1")
	if err != nil {
		t.Fatal(err)
	}
	if res != entry.GateReplay {
		t.Fatalf("got %v, want GateReplay", res)
	}
	if string(body) != `{"id": "x", "seq": 1}` && string(body) != `{"id":"x","seq":1}` {
		t.Fatalf("unexpected replay body: %s", body)
	}
}

func TestGate_HashMismatchRejected(t *testing.T) {
	s := TestStore(t)
	key := uuid.New()
	ctx := context.Background()
	s.Acquire(ctx, key, "hash1")
	res, _, err := s.Acquire(ctx, key, "DIFFERENT")
	if err != nil {
		t.Fatal(err)
	}
	if res != entry.GateMismatch {
		t.Fatalf("got %v, want GateMismatch", res)
	}
}

func TestSweepStalePending(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()
	stale, fresh := uuid.New(), uuid.New()
	s.Acquire(ctx, stale, "h")
	s.Acquire(ctx, fresh, "h")
	_, err := s.Pool.Exec(ctx,
		`UPDATE idempotency_keys SET created_at = now() - interval '10 minutes' WHERE key=$1`, stale)
	if err != nil {
		t.Fatal(err)
	}
	n, err := s.SweepStalePending(ctx, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("swept %d rows, want 1", n)
	}
	// The stale key can now be re-acquired; the fresh one is still in flight.
	if res, _, _ := s.Acquire(ctx, stale, "h"); res != entry.GateProceed {
		t.Fatalf("stale key after sweep: got %v, want GateProceed", res)
	}
	if res, _, _ := s.Acquire(ctx, fresh, "h"); res != entry.GateInFlight {
		t.Fatalf("fresh key after sweep: got %v, want GateInFlight", res)
	}
}

func TestReleaseIdempotencyKey_PendingOnly(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()

	// A released pending key can be re-acquired immediately.
	key := uuid.New()
	s.Acquire(ctx, key, "h")
	if err := s.Release(ctx, key); err != nil {
		t.Fatal(err)
	}
	if res, _, _ := s.Acquire(ctx, key, "h"); res != entry.GateProceed {
		t.Fatalf("after release: got %v, want GateProceed", res)
	}

	// A succeeded key must never be released — the response snapshot is truth.
	done := uuid.New()
	s.Acquire(ctx, done, "h")
	if _, err := s.Pool.Exec(ctx,
		`UPDATE idempotency_keys SET status='succeeded', response_body='{}' WHERE key=$1`, done); err != nil {
		t.Fatal(err)
	}
	if err := s.Release(ctx, done); err != nil {
		t.Fatal(err)
	}
	if res, _, _ := s.Acquire(ctx, done, "h"); res != entry.GateReplay {
		t.Fatalf("succeeded key survived release: got %v, want GateReplay", res)
	}
}
```

- [ ] **Step 8: Verify (requires local Postgres)**

```bash
make db-up
TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' \
  CGO_ENABLED=0 go test -p 1 ./internal/infrastructure/postgres/... -race -v
CGO_ENABLED=0 go build ./internal/domain/... ./internal/infrastructure/...
```

Expected: all moved/rewritten tests pass (append-only trigger test, all 6 idempotency-gate tests); build succeeds. `cmd/api` and `internal/api` will **not** build yet at this point — that's expected and fixed in Task 5, not a regression to chase now.

- [ ] **Step 9: Commit**

```bash
git add internal/infrastructure internal/domain
git status --short internal/store  # should show nothing — directory is gone
git commit -m "refactor: move internal/store to internal/infrastructure/postgres, implement domain ports"
```

---

### Task 4: Create `application/addentry`

**Files:**
- Create: `internal/application/addentry/addentry.go`

**Interfaces:**
- Consumes: `entry.Input`, `entry.Repository`, `entry.IdempotencyGate`, `entry.GateResult`+consts (Task 2); `ledger.SplitRule`, `ledger.Posting`, `ledger.ComputePostings`, `ledger.SettlementPostings` (Task 1)
- Produces: `addentry.Service{Gate entry.IdempotencyGate, Entries entry.Repository}`, `addentry.Command`, `addentry.Result{Gate entry.GateResult, Body []byte}`, `addentry.ErrCounterpartyRequired`, `addentry.ErrUnknownKind`, `addentry.ValidationError` (wraps a postings-computation error; `errors.As`-able), method `Service.AddEntry(ctx, Command) (Result, error)`.

- [ ] **Step 1: Write `internal/application/addentry/addentry.go`**

```go
// Package addentry implements the write path's application service:
// compute postings → idempotency gate → persist, orchestrating the
// domain/entry ports. Postings are computed before the gate is touched —
// pure validation costs nothing, and a bad request should never create a
// pending idempotency row (see architecture.md §7).
package addentry

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
)

// ErrCounterpartyRequired means a settlement entry was submitted without a
// counterparty.
var ErrCounterpartyRequired = errors.New("settlement requires counterparty")

// ErrUnknownKind means the entry kind is neither "expense" nor "settlement".
var ErrUnknownKind = errors.New("kind must be expense or settlement")

// ValidationError wraps a postings-computation failure (an invalid
// split_rule, amount, or participant list) that should be reported to the
// caller as a client error, not an internal one.
type ValidationError struct{ Err error }

func (e *ValidationError) Error() string { return e.Err.Error() }
func (e *ValidationError) Unwrap() error { return e.Err }

// Command is everything AddEntry needs to create one entry.
type Command struct {
	ID             uuid.UUID
	GroupID        uuid.UUID
	Kind           string
	PayerID        uuid.UUID
	Counterparty   *uuid.UUID
	TotalAmount    int64
	SplitRule      ledger.SplitRule
	Participants   []uuid.UUID
	Memo           string
	OccurredOn     time.Time
	CreatedBy      uuid.UUID
	IdempotencyKey uuid.UUID
	RequestHash    string
}

// Result is AddEntry's outcome. Gate reports whether this call actually
// persisted a new entry (GateProceed) or short-circuited on the idempotency
// gate (Replay/InFlight/Mismatch); Body is the response snapshot to return
// to the caller either way. Result is only meaningful when AddEntry returns
// a nil error.
type Result struct {
	Gate entry.GateResult
	Body []byte
}

type Service struct {
	Gate    entry.IdempotencyGate
	Entries entry.Repository
}

func (s *Service) AddEntry(ctx context.Context, cmd Command) (Result, error) {
	postings, splitJSON, participants, err := computePostings(cmd)
	if err != nil {
		return Result{}, err
	}

	gate, stored, err := s.Gate.Acquire(ctx, cmd.IdempotencyKey, cmd.RequestHash)
	if err != nil {
		return Result{}, err
	}
	if gate != entry.GateProceed {
		return Result{Gate: gate, Body: stored}, nil
	}

	resp, err := s.Entries.Create(ctx, cmd.IdempotencyKey, entry.Input{
		ID: cmd.ID, GroupID: cmd.GroupID, Kind: cmd.Kind, PayerID: cmd.PayerID,
		Counterparty: cmd.Counterparty, TotalAmount: cmd.TotalAmount,
		SplitRule: splitJSON, Participants: participants, Memo: cmd.Memo,
		OccurredOn: cmd.OccurredOn, CreatedBy: cmd.CreatedBy,
	}, postings)
	if err != nil {
		// We own the pending row; free it so the client's retry isn't stuck
		// behind the janitor. Best-effort — the janitor is the backstop.
		if relErr := s.Gate.Release(ctx, cmd.IdempotencyKey); relErr != nil {
			slog.Warn("release idempotency key", "key", cmd.IdempotencyKey, "err", relErr)
		}
		return Result{}, err
	}
	return Result{Gate: entry.GateProceed, Body: resp}, nil
}

func computePostings(cmd Command) (postings []ledger.Posting, splitJSON []byte, participants []uuid.UUID, err error) {
	participants = cmd.Participants
	switch cmd.Kind {
	case "expense":
		postings, err = ledger.ComputePostings(cmd.PayerID, cmd.TotalAmount, cmd.SplitRule, cmd.Participants)
		if err == nil {
			splitJSON, err = json.Marshal(cmd.SplitRule)
		}
	case "settlement":
		if cmd.Counterparty == nil {
			return nil, nil, nil, ErrCounterpartyRequired
		}
		postings, err = ledger.SettlementPostings(cmd.PayerID, *cmd.Counterparty, cmd.TotalAmount)
		// "settlement" is not one of ledger.SplitType's four constants (equal/exact/
		// shares/percent) — harmless today since nothing recomputes postings from
		// split_rule, but a future feature deserializing split_rule to recompute
		// postings must special-case kind == "settlement" rather than treating this
		// as a ledger.SplitType.
		splitJSON = []byte(`{"type":"settlement"}`)
		participants = []uuid.UUID{cmd.PayerID, *cmd.Counterparty}
	default:
		return nil, nil, nil, ErrUnknownKind
	}
	if err != nil {
		return nil, nil, nil, &ValidationError{Err: err}
	}
	return postings, splitJSON, participants, nil
}
```

- [ ] **Step 2: Verify**

```bash
CGO_ENABLED=0 go build ./internal/application/...
CGO_ENABLED=0 go vet ./internal/application/...
```

Expected: both succeed. No test file is added here — `addentry`'s orchestration is exercised end-to-end by the integration tests moved in Task 5, matching this restructure's "zero behavior change, no new test surface" scope.

- [ ] **Step 3: Commit**

```bash
git add internal/application
git commit -m "feat: add application/addentry write-path orchestration service"
```

---

### Task 5: Move `internal/api` → `internal/interfaces/rest`, wire through `addentry`, update `cmd/api`

**Files:**
- Move+rewrite: `internal/api/server.go` → `internal/interfaces/rest/server.go`
- Move+rewrite: `internal/api/entries.go` → `internal/interfaces/rest/entries.go`
- Move+rewrite: `internal/api/entries_test.go` → `internal/interfaces/rest/entries_test.go`
- Modify: `cmd/api/main.go`
- Delete: `internal/api/`

**Interfaces:**
- Consumes: `addentry.Service`, `addentry.Command`, `addentry.Result`, `addentry.ErrCounterpartyRequired`, `addentry.ErrUnknownKind`, `addentry.ValidationError` (Task 4); `entry.GateResult`+consts, `entry.ErrDuplicateID` (Task 2); `group.ErrNotMember` (Task 2); `postgres.Store`, `postgres.TestStore` (Task 3); `ledger.SplitRule` (Task 1)
- Produces: `rest.NewServer(entries *addentry.Service) http.Handler` (same route: `POST /groups/{group_id}/entries`)

- [ ] **Step 1: Move the directory**

```bash
mkdir -p internal/interfaces
git mv internal/api internal/interfaces/rest
```

- [ ] **Step 2: Rewrite `internal/interfaces/rest/server.go`**

```go
// Package rest is the thin HTTP layer: decode, build a command, call the
// application service, translate the result.
package rest

import (
	"net/http"

	"tallyup/internal/application/addentry"
)

type Server struct {
	entries *addentry.Service
}

func NewServer(entries *addentry.Service) http.Handler {
	srv := &Server{entries: entries}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /groups/{group_id}/entries", srv.handleCreateEntry)
	return mux
}
```

- [ ] **Step 3: Rewrite `internal/interfaces/rest/entries.go`**

```go
package rest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/application/addentry"
	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/group"
	"tallyup/internal/domain/ledger"
)

const maxBodyBytes = 1 << 20

type createEntryRequest struct {
	ID           uuid.UUID        `json:"id"`
	Kind         string           `json:"kind"`
	PayerID      uuid.UUID        `json:"payer_id"`
	Counterparty *uuid.UUID       `json:"counterparty,omitempty"`
	TotalAmount  int64            `json:"total_amount"`
	SplitRule    ledger.SplitRule `json:"split_rule"`
	Participants []uuid.UUID      `json:"participants"`
	Memo         string           `json:"memo,omitempty"`
	OccurredOn   string           `json:"occurred_on"` // YYYY-MM-DD
}

func (s *Server) handleCreateEntry(w http.ResponseWriter, r *http.Request) {
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

	var req createEntryRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.ID == uuid.Nil {
		httpError(w, http.StatusBadRequest, "entry id required (client-generated UUID)")
		return
	}
	occurredOn, err := time.Parse("2006-01-02", req.OccurredOn)
	if err != nil {
		httpError(w, http.StatusBadRequest, "occurred_on must be YYYY-MM-DD")
		return
	}

	result, err := s.entries.AddEntry(r.Context(), addentry.Command{
		ID: req.ID, GroupID: groupID, Kind: req.Kind, PayerID: req.PayerID,
		Counterparty: req.Counterparty, TotalAmount: req.TotalAmount,
		SplitRule: req.SplitRule, Participants: req.Participants, Memo: req.Memo,
		// CreatedBy is hardwired to PayerID for now, conflating "who recorded the
		// entry" with "who paid" — placeholder pending real auth.
		OccurredOn: occurredOn, CreatedBy: req.PayerID,
		IdempotencyKey: key, RequestHash: requestHash,
	})

	var valErr *addentry.ValidationError
	switch {
	case errors.Is(err, addentry.ErrCounterpartyRequired):
		httpError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, addentry.ErrUnknownKind):
		httpError(w, http.StatusBadRequest, err.Error())
	case errors.As(err, &valErr):
		httpError(w, http.StatusUnprocessableEntity, valErr.Error())
	case errors.Is(err, group.ErrNotMember):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, entry.ErrDuplicateID):
		httpError(w, http.StatusConflict, err.Error())
	case err != nil:
		httpError(w, http.StatusInternalServerError, "write failed")
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

func writeJSON(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}

func httpError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
```

- [ ] **Step 4: Rewrite `internal/interfaces/rest/entries_test.go`**

Only the imports and the three helpers that construct the server change (`seedGroup`'s parameter type, `newTestServer`'s wiring, and the `ledger`/`postgres` import paths). Every `Test...` function body (`TestCreateExpense_HappyPath` through `TestConcurrency_DistinctKeys50x_AllLand`) is copied verbatim — they only reference `post`, `newTestServer`, `expenseBody`, `srv`, `s.Pool`, `gID`/`yuto`/`memA`/`memB`, and `ledger.SplitRule`/`ledger.SplitShares`, all of which resolve correctly through the updated helpers below.

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

	"tallyup/internal/application/addentry"
	"tallyup/internal/domain/ledger"
	"tallyup/internal/infrastructure/postgres"
)

var (
	gID  = uuid.MustParse("00000000-0000-0000-0000-0000000000a1")
	yuto = uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	memA = uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	memB = uuid.MustParse("00000000-0000-0000-0000-00000000000c")
)

// seedGroup inserts the standard 3-member test group.
// One statement per Exec: pgx v5's extended protocol rejects multi-statement
// calls, and bind parameters can never span statements anyway.
func seedGroup(t *testing.T, s *postgres.Store) {
	t.Helper()
	ctx := context.Background()
	stmts := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO members (id, name) VALUES ($1,'yuto'), ($2,'a'), ($3,'b')`, []any{yuto, memA, memB}},
		{`INSERT INTO groups (id, name) VALUES ($1, 'trip')`, []any{gID}},
		{`INSERT INTO group_members (group_id, member_id) VALUES ($1,$2), ($1,$3), ($1,$4)`, []any{gID, yuto, memA, memB}},
	}
	for _, st := range stmts {
		if _, err := s.Pool.Exec(ctx, st.sql, st.args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
}

func expenseBody(entryID uuid.UUID) []byte {
	b, _ := json.Marshal(map[string]any{
		"id": entryID, "kind": "expense", "payer_id": yuto,
		"total_amount": 12000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, memA, memB},
		"memo":         "dinner", "occurred_on": "2026-07-05",
	})
	return b
}

func post(t *testing.T, srv *httptest.Server, key uuid.UUID, body []byte) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest("POST", srv.URL+fmt.Sprintf("/groups/%s/entries", gID), bytes.NewReader(body))
	req.Header.Set("Idempotency-Key", key.String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	return resp, rb
}

func newTestServer(t *testing.T) (*httptest.Server, *postgres.Store) {
	s := postgres.TestStore(t)
	seedGroup(t, s)
	svc := &addentry.Service{Gate: s, Entries: s}
	srv := httptest.NewServer(NewServer(svc))
	t.Cleanup(srv.Close)
	return srv, s
}
```

Then append every `Test...` function from the current `internal/api/entries_test.go` (lines 79–344: `TestCreateExpense_HappyPath`, `TestCreateExpense_ReplaySameKeySameBody`, `TestCreateExpense_SameKeyDifferentBodyIs422`, `TestCreateExpense_NonMemberParticipantIs422`, `TestCreateExpense_WeightedSharesRoundTrip`, `TestCreateSettlement`, `TestPostGateFailureReleasesKey_RetryProceeds`, `TestMissingIdempotencyKeyIs400`, `TestConcurrency_SameKey50x_ExactlyOneEntry`, `TestConcurrency_DistinctKeys50x_AllLand`) unchanged, character for character.

- [ ] **Step 5: Update `cmd/api/main.go`**

```go
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tallyup/internal/application/addentry"
	"tallyup/internal/infrastructure/postgres"
	"tallyup/internal/interfaces/rest"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		slog.Error("DATABASE_URL required")
		os.Exit(1)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	s, err := postgres.New(ctx, dbURL)
	if err != nil {
		slog.Error("store init", "err", err)
		os.Exit(1)
	}
	defer s.Pool.Close()

	// Idempotency janitor: expire stale pending keys so crashed writes can retry.
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if n, err := s.SweepStalePending(ctx, time.Minute); err != nil {
					slog.Warn("janitor sweep", "err", err)
				} else if n > 0 {
					slog.Info("janitor swept stale pending keys", "count", n)
				}
			}
		}
	}()

	entries := &addentry.Service{Gate: s, Entries: s}
	srv := &http.Server{Addr: ":" + port, Handler: rest.NewServer(entries)}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx) // drains in-flight requests/transactions
	}()

	slog.Info("tallyup api listening", "port", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}
```

- [ ] **Step 6: Verify**

```bash
CGO_ENABLED=0 go build ./...
git status --short internal/api  # should show nothing — directory is gone
make test
```

Expected: full build succeeds; `make test` (`TEST_DATABASE_URL=... go test -p 1 ./... -race`) passes in full — every test in `internal/domain/ledger`, `internal/infrastructure/postgres`, and `internal/interfaces/rest`, including the two 50x concurrency chaos tests.

- [ ] **Step 7: Manual smoke test**

```bash
make run &
sleep 1
make seed
make smoke
kill %1
```

Expected: `make smoke` prints a `201` response with `{"id":"...","seq":N}`.

- [ ] **Step 8: Commit**

```bash
git add internal/interfaces cmd/api/main.go
git commit -m "refactor: move internal/api to internal/interfaces/rest, wire through application/addentry"
```

---

### Task 6: Update documentation

**Files:**
- Modify: `docs/architecture.md:297`
- Modify: `README.md:60,62,68`
- Modify: `docs/superpowers/plans/2026-07-05-reads-and-reversals.md`
- Modify: `docs/superpowers/plans/2026-07-05-nextjs-client.md`
- Modify: `docs/superpowers/plans/2026-07-05-settle-up.md`
- Modify: `docs/superpowers/plans/2026-07-06-pairwise-and-member-management.md`
- Modify: `docs/superpowers/plans/2026-07-06-group-password.md`

**Scope note:** per the issue, this is a path/package-name update, not a re-derivation of each future phase's design against the new layered interfaces. Symbol-level references inside these not-yet-executed plans (e.g. `store.CreateEntry`, `api.NewServer`) are left as-is; whoever plans each phase re-derives the exact new call sites against `entry.Repository`/`addentry.Service`/etc. at that time. `docs/superpowers/plans/2026-07-05-ledger-core-write-path.md` is a historical record of already-executed work and is intentionally not touched.

- [ ] **Step 1: Fix `docs/architecture.md`**

Change line 297 from:

```
1. **Ledger core (Go package)** — `internal/ledger`: postings computation for all four split rules, zero-sum + determinism property tests (`testing/quick` or `rapid`). *(The correctness heart. A pure package with tests, before any HTTP or DB.)*
```

to:

```
1. **Ledger core (Go package)** — `internal/domain/ledger`: postings computation for all four split rules, zero-sum + determinism property tests (`testing/quick` or `rapid`). *(The correctness heart. A pure package with tests, before any HTTP or DB.)*
```

- [ ] **Step 2: Fix `README.md`**

Change line 60 from:

```
Tests in `internal/store` and `internal/api` need a real Postgres to exercise the JSONB storage, idempotency gate, and constraint behavior — they skip cleanly if no database is configured, but you won't get real coverage without one. `make test` (or `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test -p 1 ./... -race`) runs the full suite correctly.
```

to:

```
Tests in `internal/infrastructure/postgres` and `internal/interfaces/rest` need a real Postgres to exercise the JSONB storage, idempotency gate, and constraint behavior — they skip cleanly if no database is configured, but you won't get real coverage without one. `make test` (or `TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go test -p 1 ./... -race`) runs the full suite correctly.
```

Change line 62 from:

```
**Always run with `-p 1` once `TEST_DATABASE_URL` is set** — `internal/api` and `internal/store` both truncate the same live Postgres tables via a shared test helper, and Go parallelizes different packages' test binaries by default, so without `-p 1` the two packages' truncations race against each other's in-flight tests and deadlock. Plain `go test ./...` (no flags) is unsafe whenever `TEST_DATABASE_URL` is exported — this is exactly what `make test` avoids for you.
```

to:

```
**Always run with `-p 1` once `TEST_DATABASE_URL` is set** — `internal/interfaces/rest` and `internal/infrastructure/postgres` both truncate the same live Postgres tables via a shared test helper, and Go parallelizes different packages' test binaries by default, so without `-p 1` the two packages' truncations race against each other's in-flight tests and deadlock. Plain `go test ./...` (no flags) is unsafe whenever `TEST_DATABASE_URL` is exported — this is exactly what `make test` avoids for you.
```

Change line 68 from:

```
`migrations/*.sql` is the source of truth. It's manually copied into `internal/store/migrations/*.sql` because Go's `go:embed` can't reach outside its own package tree — the store package embeds its local copy at build time. If you add or change a migration, copy it to both locations; there's no automated drift check yet.
```

to:

```
`migrations/*.sql` is the source of truth. It's manually copied into `internal/infrastructure/postgres/migrations/*.sql` because Go's `go:embed` can't reach outside its own package tree — the postgres package embeds its local copy at build time. If you add or change a migration, copy it to both locations; there's no automated drift check yet.
```

- [ ] **Step 3: Scripted path substitution across the five forward plan docs**

```bash
for f in docs/superpowers/plans/2026-07-05-reads-and-reversals.md \
         docs/superpowers/plans/2026-07-05-nextjs-client.md \
         docs/superpowers/plans/2026-07-05-settle-up.md \
         docs/superpowers/plans/2026-07-06-pairwise-and-member-management.md \
         docs/superpowers/plans/2026-07-06-group-password.md; do
  sed -i '' \
    -e 's#internal/store/migrations#internal/infrastructure/postgres/migrations#g' \
    -e 's#internal/store/#internal/infrastructure/postgres/#g' \
    -e 's#internal/store#internal/infrastructure/postgres#g' \
    -e 's#internal/api/#internal/interfaces/rest/#g' \
    -e 's#internal/api#internal/interfaces/rest#g' \
    -e 's#internal/ledger/#internal/domain/ledger/#g' \
    -e 's#internal/ledger#internal/domain/ledger#g' \
    "$f"
done
```

(On Linux, drop the empty string after `-i`: `sed -i -e ...`.)

- [ ] **Step 4: Spot-check for stragglers**

```bash
grep -rn "internal/ledger\b\|internal/store\b\|internal/api\b" README.md docs/architecture.md \
  docs/superpowers/plans/2026-07-05-reads-and-reversals.md \
  docs/superpowers/plans/2026-07-05-nextjs-client.md \
  docs/superpowers/plans/2026-07-05-settle-up.md \
  docs/superpowers/plans/2026-07-06-pairwise-and-member-management.md \
  docs/superpowers/plans/2026-07-06-group-password.md
grep -rn "store package\|api package" README.md docs/architecture.md \
  docs/superpowers/plans/2026-07-05-reads-and-reversals.md \
  docs/superpowers/plans/2026-07-05-nextjs-client.md \
  docs/superpowers/plans/2026-07-05-settle-up.md \
  docs/superpowers/plans/2026-07-06-pairwise-and-member-management.md \
  docs/superpowers/plans/2026-07-06-group-password.md
```

Expected: no matches. If either grep finds a stray prose reference (not inside an already-updated path or a symbol name like `store.Store`), fix it manually.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md README.md docs/superpowers/plans/2026-07-05-reads-and-reversals.md \
  docs/superpowers/plans/2026-07-05-nextjs-client.md docs/superpowers/plans/2026-07-05-settle-up.md \
  docs/superpowers/plans/2026-07-06-pairwise-and-member-management.md \
  docs/superpowers/plans/2026-07-06-group-password.md
git commit -m "docs: update file-structure references to the new DDD layout"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm old packages are gone**

```bash
test ! -d internal/ledger && test ! -d internal/store && test ! -d internal/api && echo "old packages removed"
```

- [ ] **Step 2: Confirm the dependency rule holds**

```bash
grep -rl "jackc/pgx" internal/ --include="*.go" | grep -v "^internal/infrastructure/postgres/"
```

Expected: no output — only `internal/infrastructure/postgres` imports pgx.

```bash
grep -rl "tallyup/internal/infrastructure" internal/interfaces internal/application --include="*.go" | grep -v "_test.go"
```

Expected: no output — only test files in `interfaces/rest` import infrastructure directly (per Global Constraints).

- [ ] **Step 3: Full build, vet, and test**

```bash
CGO_ENABLED=0 go build ./...
CGO_ENABLED=0 go vet ./...
make test
```

Expected: all green, including both 50x concurrency chaos tests in `internal/interfaces/rest`.

- [ ] **Step 4: Full manual smoke test**

```bash
make run &
sleep 1
make seed
make smoke
kill %1
make db-down
```

Expected: `201` with `{"id":"...","seq":N}`, identical to pre-restructure behavior.

- [ ] **Step 5: Final review pass**

Re-read the diff end to end (`git diff main --stat` and a skim of each changed file) and confirm: no accidental logic changes beyond the moves/renames documented in Tasks 1–6, no leftover references to the old package paths anywhere (`grep -rn "internal/ledger\|internal/store\|internal/api" --include="*.go" .`), and the acceptance criteria in issue #59 are all checked off.
