# tally-up — Ledger Core + Write Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the correctness heart of "tally-up" — a pure Go ledger package (all four split rules, deterministic rounding) plus the idempotent HTTP write path backed by Postgres, per `docs/architecture.md` Phases 1–2.

**Architecture:** Append-only double-entry ledger. A pure `internal/ledger` package computes zero-sum postings from split rules with largest-remainder rounding (ties broken by ascending member UUID). The write path is: validate → pending-row-first idempotency gate (own committed txn) → one `pgx` transaction inserting entry + postings and marking the key succeeded. A janitor goroutine expires stale pending keys.

**Tech Stack:** Go 1.23+, stdlib `net/http` ServeMux (Go 1.22 method+path patterns), `github.com/jackc/pgx/v5`, `github.com/google/uuid`, `pgregory.net/rapid` (property tests), `github.com/golang-migrate/migrate/v4` (embedded SQL migrations), Postgres 16 via docker compose for tests.

## Global Constraints

- Money is **integer yen** in `int64`. No floats anywhere in the money path. Ever.
- `total_amount` must be in `(0, 100_000_000_000]` (¥100B cap — keeps `total * weight` inside int64).
- Rounding: **largest-remainder method**, ties broken by **ascending member UUID (byte order)**. Same input → byte-identical postings, always.
- Postings for an entry exist only for `participants ∪ {payer}` (∪ `{counterparty}` for settlements), and every such member must belong to the group.
- Ledger tables (`entries`, `postings`) are **append-only**, enforced by a `BEFORE UPDATE OR DELETE` trigger. (Row-level triggers do not block `TRUNCATE`, so tests can still reset state.)
- Idempotency: pending-row-first. Same key + same payload → at most one entry, byte-identical response. Same key + different payload → `422`, never a replay.
- Isolation: plain `READ COMMITTED` transactions for the add path (adds commute).
- All IDs are **UUIDv7**, minted in application code, never by the database. Go: `uuid.NewV7()` from `github.com/google/uuid` (requires v1.6.0+, which `go get github.com/google/uuid@latest` already picks up). `id` columns have no `DEFAULT` — every insert supplies one explicitly, so there's no path that could silently produce a different UUID version.
- Module path: `tallyup` (local module; swap for a full path if ever published).
- Branch: `feat/issue-1-ledger-core-write-path` (create it in Task 1, Step 1; all commits land there).
- Integration tests read `TEST_DATABASE_URL` and **skip** when unset. Dev value: `postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable` (docker compose, Task 5).

## File Structure

```
go.mod                              — module tallyup
docker-compose.yml                  — postgres:16 for dev/tests (Task 5)
migrations/0001_init.up.sql         — full schema from architecture.md §6 + trigger + indexes
migrations/0001_init.down.sql
internal/ledger/ledger.go           — types: SplitType, SplitRule, Posting, MaxAmount
internal/ledger/split.go            — ComputePostings, SettlementPostings, largest-remainder engine
internal/ledger/split_test.go       — example-based tests (Tasks 1–3)
internal/ledger/property_test.go    — rapid property tests (Task 4)
internal/store/store.go             — pgxpool wiring, migrations runner, test helpers
internal/store/idempotency.go       — AcquireIdempotencyKey gate, SweepStalePending
internal/store/idempotency_test.go
internal/store/entries.go           — CreateEntry (single txn: membership check, entry, postings, mark key)
internal/api/server.go              — ServeMux routes
internal/api/entries.go             — POST /groups/{group_id}/entries handler
internal/api/entries_test.go        — integration tests incl. 50× concurrency (Tasks 7, 9)
cmd/api/main.go                     — env config, migrations, janitor goroutine, graceful shutdown (Task 8)
```

Design note (DRY): `equal`, `shares`, and `percent` are all the same weighted largest-remainder computation — `equal` is weights-all-1, `percent` is shares with a Σ=100 validation. Only `exact` bypasses the engine.

---

### Task 1: Ledger package — types + equal split with deterministic rounding

**Files:**
- Create: `go.mod`, `internal/ledger/ledger.go`, `internal/ledger/split.go`
- Test: `internal/ledger/split_test.go`

**Interfaces:**
- Produces: `ledger.ComputePostings(payer uuid.UUID, total int64, rule SplitRule, participants []uuid.UUID) ([]Posting, error)`; types `SplitType` (`SplitEqual|SplitExact|SplitShares|SplitPercent`), `SplitRule{Type SplitType; Amounts map[uuid.UUID]int64; Weights map[uuid.UUID]int64}`, `Posting{MemberID uuid.UUID; Amount int64}`, `const MaxAmount int64`. Postings are sorted by member UUID bytes ascending; zero-net members are omitted.

- [ ] **Step 1: Scaffold module on a fresh branch**

```bash
cd /Users/yuto/Documents/Web_Development/projects/tally-up
git checkout -b feat/issue-1-ledger-core-write-path
go mod init tallyup
go get github.com/google/uuid@latest
```

- [ ] **Step 2: Write the failing tests**

`internal/ledger/split_test.go`:

```go
package ledger

import (
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// Fixed IDs whose byte order is yuto < memA < memB < memC.
var (
	yuto = uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	memA = uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	memB = uuid.MustParse("00000000-0000-0000-0000-00000000000c")
	memC = uuid.MustParse("00000000-0000-0000-0000-00000000000d")
)

func mustCompute(t *testing.T, payer uuid.UUID, total int64, rule SplitRule, parts []uuid.UUID) []Posting {
	t.Helper()
	got, err := ComputePostings(payer, total, rule, parts)
	if err != nil {
		t.Fatalf("ComputePostings: %v", err)
	}
	return got
}

func TestEqualSplit_PayerParticipates(t *testing.T) {
	// The worked example from architecture.md §3.
	got := mustCompute(t, yuto, 12000, SplitRule{Type: SplitEqual}, []uuid.UUID{yuto, memA, memB})
	want := []Posting{{yuto, 8000}, {memA, -4000}, {memB, -4000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestEqualSplit_PayerNotParticipant_RemainderTieGoesToSmallestID(t *testing.T) {
	// 10000/3 leaves 1 yen; all remainders tie, so smallest member ID (memA) pays it.
	got := mustCompute(t, yuto, 10000, SplitRule{Type: SplitEqual}, []uuid.UUID{memA, memB, memC})
	want := []Posting{{yuto, 10000}, {memA, -3334}, {memB, -3333}, {memC, -3333}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestEqualSplit_PayerSoleParticipant_NoPostings(t *testing.T) {
	got := mustCompute(t, yuto, 5000, SplitRule{Type: SplitEqual}, []uuid.UUID{yuto})
	if len(got) != 0 {
		t.Fatalf("expected no postings, got %v", got)
	}
}

func TestComputePostings_Validation(t *testing.T) {
	cases := []struct {
		name  string
		total int64
		parts []uuid.UUID
	}{
		{"zero total", 0, []uuid.UUID{memA}},
		{"negative total", -100, []uuid.UUID{memA}},
		{"over cap", MaxAmount + 1, []uuid.UUID{memA}},
		{"no participants", 1000, nil},
		{"duplicate participant", 1000, []uuid.UUID{memA, memA}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := ComputePostings(yuto, c.total, SplitRule{Type: SplitEqual}, c.parts); err == nil {
				t.Fatal("expected error, got nil")
			}
		})
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `go test ./internal/ledger/ -v`
Expected: compile FAIL — `undefined: ComputePostings`, `undefined: SplitRule`, etc.

- [ ] **Step 4: Implement types and the weighted engine**

`internal/ledger/ledger.go`:

```go
// Package ledger computes double-entry postings for tally-up's append-only ledger.
// All amounts are integer yen. Computation is deterministic: identical inputs
// always produce identical postings (rounding included).
package ledger

import "github.com/google/uuid"

// MaxAmount caps totals at ¥100B so total*weight stays inside int64.
const MaxAmount = int64(100_000_000_000)

type SplitType string

const (
	SplitEqual   SplitType = "equal"
	SplitExact   SplitType = "exact"
	SplitShares  SplitType = "shares"
	SplitPercent SplitType = "percent"
)

// SplitRule is stored verbatim on the entry (JSONB) and applied at write time.
// Amounts is used by exact; Weights by shares and percent.
type SplitRule struct {
	Type    SplitType           `json:"type"`
	Amounts map[uuid.UUID]int64 `json:"amounts,omitempty"`
	Weights map[uuid.UUID]int64 `json:"weights,omitempty"`
}

// Posting is one member's signed net amount for an entry.
type Posting struct {
	MemberID uuid.UUID `json:"member_id"`
	Amount   int64     `json:"amount"`
}
```

`internal/ledger/split.go`:

```go
package ledger

import (
	"bytes"
	"fmt"
	"sort"

	"github.com/google/uuid"
)

const maxWeight = int64(1_000_000)

// ComputePostings expands one expense into signed postings that sum to zero.
// The payer need not be a participant; members with zero net are omitted.
// Output is sorted by member UUID bytes ascending.
func ComputePostings(payer uuid.UUID, total int64, rule SplitRule, participants []uuid.UUID) ([]Posting, error) {
	if total <= 0 || total > MaxAmount {
		return nil, fmt.Errorf("total must be in (0, %d], got %d", MaxAmount, total)
	}
	if len(participants) == 0 {
		return nil, fmt.Errorf("at least one participant required")
	}
	seen := make(map[uuid.UUID]bool, len(participants))
	for _, p := range participants {
		if seen[p] {
			return nil, fmt.Errorf("duplicate participant %s", p)
		}
		seen[p] = true
	}

	shares, err := computeShares(total, rule, participants)
	if err != nil {
		return nil, err
	}

	net := make(map[uuid.UUID]int64, len(participants)+1)
	for m, s := range shares {
		net[m] -= s
	}
	net[payer] += total

	members := make([]uuid.UUID, 0, len(net))
	for m, amt := range net {
		if amt != 0 {
			members = append(members, m)
		}
	}
	sort.Slice(members, func(i, j int) bool {
		return bytes.Compare(members[i][:], members[j][:]) < 0
	})
	postings := make([]Posting, len(members))
	for i, m := range members {
		postings[i] = Posting{MemberID: m, Amount: net[m]}
	}
	return postings, nil
}

func computeShares(total int64, rule SplitRule, participants []uuid.UUID) (map[uuid.UUID]int64, error) {
	switch rule.Type {
	case SplitEqual:
		w := make(map[uuid.UUID]int64, len(participants))
		for _, p := range participants {
			w[p] = 1
		}
		return weightedShares(total, w, participants)
	default:
		return nil, fmt.Errorf("unknown split type %q", rule.Type)
	}
}

// weightedShares distributes total across participants proportionally to
// weights using the largest-remainder method; remainder-yen ties are broken
// by ascending member UUID. Guarantees the shares sum to exactly total.
func weightedShares(total int64, weights map[uuid.UUID]int64, participants []uuid.UUID) (map[uuid.UUID]int64, error) {
	var totalWeight int64
	for _, p := range participants {
		w := weights[p]
		if w <= 0 || w > maxWeight {
			return nil, fmt.Errorf("weight for %s must be in (0, %d], got %d", p, maxWeight, w)
		}
		totalWeight += w
	}

	type remainder struct {
		member uuid.UUID
		rem    int64
	}
	shares := make(map[uuid.UUID]int64, len(participants))
	remainders := make([]remainder, 0, len(participants))
	var assigned int64
	for _, p := range participants {
		base := total * weights[p] / totalWeight
		shares[p] = base
		assigned += base
		remainders = append(remainders, remainder{p, total * weights[p] % totalWeight})
	}
	sort.Slice(remainders, func(i, j int) bool {
		if remainders[i].rem != remainders[j].rem {
			return remainders[i].rem > remainders[j].rem
		}
		return bytes.Compare(remainders[i].member[:], remainders[j].member[:]) < 0
	})
	for i := int64(0); i < total-assigned; i++ {
		shares[remainders[i].member]++
	}
	return shares, nil
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/ledger/ -v`
Expected: PASS (all 4 test functions).

- [ ] **Step 6: Commit**

```bash
git add go.mod go.sum internal/ledger/
git commit -m "feat: ledger package with equal split and largest-remainder rounding"
```

---

### Task 2: Shares and percent splits

**Files:**
- Modify: `internal/ledger/split.go` (extend `computeShares`)
- Test: `internal/ledger/split_test.go` (append)

**Interfaces:**
- Consumes: `weightedShares` from Task 1.
- Produces: `SplitShares` and `SplitPercent` handling inside `ComputePostings` — `Weights` must cover exactly the participants; percent weights must sum to 100.

- [ ] **Step 1: Write the failing tests**

Append to `internal/ledger/split_test.go`:

```go
func TestSharesSplit_HotelRooms(t *testing.T) {
	// 2:2:1 (couples vs. single), ¥30,000 → 12,000 / 12,000 / 6,000.
	rule := SplitRule{Type: SplitShares, Weights: map[uuid.UUID]int64{memA: 2, memB: 2, memC: 1}}
	got := mustCompute(t, memA, 30000, rule, []uuid.UUID{memA, memB, memC})
	want := []Posting{{memA, 18000}, {memB, -12000}, {memC, -6000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestSharesSplit_LargestRemainderFavorsBiggerRemainder(t *testing.T) {
	// ¥100 at 1:2 → bases 33+66=99; remainders 1 vs 2 → extra yen to the 2-share member.
	rule := SplitRule{Type: SplitShares, Weights: map[uuid.UUID]int64{memA: 1, memB: 2}}
	got := mustCompute(t, yuto, 100, rule, []uuid.UUID{memA, memB})
	want := []Posting{{yuto, 100}, {memA, -33}, {memB, -67}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestSharesSplit_WeightsMustCoverParticipants(t *testing.T) {
	rule := SplitRule{Type: SplitShares, Weights: map[uuid.UUID]int64{memA: 1}}
	if _, err := ComputePostings(yuto, 100, rule, []uuid.UUID{memA, memB}); err == nil {
		t.Fatal("expected error for missing weight")
	}
	rule = SplitRule{Type: SplitShares, Weights: map[uuid.UUID]int64{memA: 1, memB: 1, memC: 1}}
	if _, err := ComputePostings(yuto, 100, rule, []uuid.UUID{memA, memB}); err == nil {
		t.Fatal("expected error for extra weight")
	}
}

func TestPercentSplit(t *testing.T) {
	rule := SplitRule{Type: SplitPercent, Weights: map[uuid.UUID]int64{memA: 50, memB: 30, memC: 20}}
	got := mustCompute(t, memC, 10000, rule, []uuid.UUID{memA, memB, memC})
	want := []Posting{{memA, -5000}, {memB, -3000}, {memC, 8000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestPercentSplit_MustSumTo100(t *testing.T) {
	rule := SplitRule{Type: SplitPercent, Weights: map[uuid.UUID]int64{memA: 50, memB: 49}}
	if _, err := ComputePostings(yuto, 10000, rule, []uuid.UUID{memA, memB}); err == nil {
		t.Fatal("expected error for percents not summing to 100")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/ledger/ -v -run 'Shares|Percent'`
Expected: FAIL — `unknown split type "shares"` / `"percent"` errors.

- [ ] **Step 3: Implement**

In `internal/ledger/split.go`, add a coverage helper and extend the switch in `computeShares`:

```go
// coversExactly ensures the rule's per-member map keys are exactly the participant set.
func coversExactly[V any](m map[uuid.UUID]V, participants []uuid.UUID) error {
	if len(m) != len(participants) {
		return fmt.Errorf("split rule covers %d members, entry has %d participants", len(m), len(participants))
	}
	for _, p := range participants {
		if _, ok := m[p]; !ok {
			return fmt.Errorf("split rule missing participant %s", p)
		}
	}
	return nil
}
```

New cases in the `computeShares` switch (before `default`):

```go
	case SplitShares:
		if err := coversExactly(rule.Weights, participants); err != nil {
			return nil, err
		}
		return weightedShares(total, rule.Weights, participants)
	case SplitPercent:
		if err := coversExactly(rule.Weights, participants); err != nil {
			return nil, err
		}
		var sum int64
		for _, w := range rule.Weights {
			sum += w
		}
		if sum != 100 {
			return nil, fmt.Errorf("percentages must sum to 100, got %d", sum)
		}
		return weightedShares(total, rule.Weights, participants)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/ledger/ -v`
Expected: PASS (all tests, including Task 1's).

- [ ] **Step 5: Commit**

```bash
git add internal/ledger/
git commit -m "feat: shares and percent split rules"
```

---

### Task 3: Exact split + settlement postings

**Files:**
- Modify: `internal/ledger/split.go`
- Test: `internal/ledger/split_test.go` (append)

**Interfaces:**
- Produces: `SplitExact` handling; `ledger.SettlementPostings(payer, counterparty uuid.UUID, amount int64) ([]Posting, error)` — payer `+amount`, counterparty `−amount`, sorted by UUID bytes.

- [ ] **Step 1: Write the failing tests**

Append to `internal/ledger/split_test.go`:

```go
func TestExactSplit(t *testing.T) {
	rule := SplitRule{Type: SplitExact, Amounts: map[uuid.UUID]int64{memA: 7000, memB: 5000}}
	got := mustCompute(t, yuto, 12000, rule, []uuid.UUID{memA, memB})
	want := []Posting{{yuto, 12000}, {memA, -7000}, {memB, -5000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExactSplit_ZeroAmountMemberOmitted(t *testing.T) {
	rule := SplitRule{Type: SplitExact, Amounts: map[uuid.UUID]int64{memA: 12000, memB: 0}}
	got := mustCompute(t, yuto, 12000, rule, []uuid.UUID{memA, memB})
	want := []Posting{{yuto, 12000}, {memA, -12000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExactSplit_MustSumToTotal(t *testing.T) {
	rule := SplitRule{Type: SplitExact, Amounts: map[uuid.UUID]int64{memA: 7000, memB: 4999}}
	if _, err := ComputePostings(yuto, 12000, rule, []uuid.UUID{memA, memB}); err == nil {
		t.Fatal("expected error for amounts not summing to total")
	}
}

func TestSettlementPostings(t *testing.T) {
	got, err := SettlementPostings(memB, memA, 4000) // B pays A ¥4,000
	if err != nil {
		t.Fatalf("SettlementPostings: %v", err)
	}
	want := []Posting{{memA, -4000}, {memB, 4000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestSettlementPostings_Validation(t *testing.T) {
	if _, err := SettlementPostings(memA, memA, 100); err == nil {
		t.Fatal("expected error for self-settlement")
	}
	if _, err := SettlementPostings(memA, memB, 0); err == nil {
		t.Fatal("expected error for zero amount")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/ledger/ -v -run 'Exact|Settlement'`
Expected: FAIL — `unknown split type "exact"`, `undefined: SettlementPostings`.

- [ ] **Step 3: Implement**

New case in the `computeShares` switch:

```go
	case SplitExact:
		if err := coversExactly(rule.Amounts, participants); err != nil {
			return nil, err
		}
		var sum int64
		for m, a := range rule.Amounts {
			if a < 0 {
				return nil, fmt.Errorf("exact amount for %s must be >= 0, got %d", m, a)
			}
			sum += a
		}
		if sum != total {
			return nil, fmt.Errorf("exact amounts sum to %d, total is %d", sum, total)
		}
		out := make(map[uuid.UUID]int64, len(rule.Amounts))
		for m, a := range rule.Amounts {
			out[m] = a
		}
		return out, nil
```

And in `split.go`, the settlement helper:

```go
// SettlementPostings records "payer paid counterparty amount": the payer's
// net position rises, the counterparty's falls. Output sorted by UUID bytes.
func SettlementPostings(payer, counterparty uuid.UUID, amount int64) ([]Posting, error) {
	if amount <= 0 || amount > MaxAmount {
		return nil, fmt.Errorf("settlement amount must be in (0, %d], got %d", MaxAmount, amount)
	}
	if payer == counterparty {
		return nil, fmt.Errorf("cannot settle with yourself")
	}
	postings := []Posting{{MemberID: payer, Amount: amount}, {MemberID: counterparty, Amount: -amount}}
	if bytes.Compare(postings[1].MemberID[:], postings[0].MemberID[:]) < 0 {
		postings[0], postings[1] = postings[1], postings[0]
	}
	return postings, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/ledger/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ledger/
git commit -m "feat: exact split and settlement postings"
```

---

### Task 4: Property tests — zero-sum, determinism, participant coverage

**Files:**
- Test: `internal/ledger/property_test.go` (create)

**Interfaces:**
- Consumes: `ComputePostings` and all four split types from Tasks 1–3.

- [ ] **Step 1: Add the rapid dependency**

```bash
go get pgregory.net/rapid@latest
```

- [ ] **Step 2: Write the property tests**

`internal/ledger/property_test.go`:

```go
package ledger

import (
	"bytes"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"pgregory.net/rapid"
)

// drawScenario generates a valid (payer, total, rule, participants) tuple
// covering all four split types.
func drawScenario(t *rapid.T) (uuid.UUID, int64, SplitRule, []uuid.UUID) {
	n := rapid.IntRange(1, 8).Draw(t, "n")
	participants := make([]uuid.UUID, n)
	seen := make(map[uuid.UUID]bool, n)
	for i := range participants {
		var id uuid.UUID
		copy(id[:], rapid.SliceOfN(rapid.Byte(), 16, 16).Draw(t, "id"))
		if seen[id] {
			t.Skip() // vanishingly rare collision
		}
		seen[id] = true
		participants[i] = id
	}
	// Payer is a participant half the time, an outsider otherwise.
	payer := participants[0]
	if rapid.Bool().Draw(t, "outsidePayer") {
		copy(payer[:], rapid.SliceOfN(rapid.Byte(), 16, 16).Draw(t, "payerID"))
	}
	total := rapid.Int64Range(1, 10_000_000).Draw(t, "total")

	var rule SplitRule
	switch rapid.IntRange(0, 3).Draw(t, "ruleType") {
	case 0:
		rule = SplitRule{Type: SplitEqual}
	case 1:
		w := make(map[uuid.UUID]int64, n)
		for _, p := range participants {
			w[p] = rapid.Int64Range(1, 20).Draw(t, "weight")
		}
		rule = SplitRule{Type: SplitShares, Weights: w}
	case 2:
		// Compose 100 into n positive parts via sorted cut points.
		if n > 100 {
			t.Skip()
		}
		w := composeInto(t, 100, participants, 1)
		rule = SplitRule{Type: SplitPercent, Weights: w}
	case 3:
		if total < int64(n) {
			t.Skip()
		}
		a := composeInto(t, total, participants, 0)
		rule = SplitRule{Type: SplitExact, Amounts: a}
	}
	return payer, total, rule, participants
}

// composeInto splits sum into len(members) parts, each >= min, summing exactly.
func composeInto(t *rapid.T, sum int64, members []uuid.UUID, min int64) map[uuid.UUID]int64 {
	n := int64(len(members))
	out := make(map[uuid.UUID]int64, n)
	remaining := sum - min*n
	for i, m := range members {
		if int64(i) == n-1 {
			out[m] = min + remaining
			break
		}
		take := rapid.Int64Range(0, remaining).Draw(t, "part")
		out[m] = min + take
		remaining -= take
	}
	return out
}

func TestProperty_ZeroSumAndCoverage(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		payer, total, rule, participants := drawScenario(t)
		postings, err := ComputePostings(payer, total, rule, participants)
		if err != nil {
			t.Fatalf("valid scenario rejected: %v", err)
		}
		var sum int64
		allowed := map[uuid.UUID]bool{payer: true}
		for _, p := range participants {
			allowed[p] = true
		}
		for _, p := range postings {
			sum += p.Amount
			if !allowed[p.MemberID] {
				t.Fatalf("posting for non-participant %s", p.MemberID)
			}
			if p.Amount == 0 {
				t.Fatalf("zero-amount posting for %s", p.MemberID)
			}
		}
		if sum != 0 {
			t.Fatalf("postings sum to %d, want 0", sum)
		}
	})
}

func TestProperty_Deterministic(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		payer, total, rule, participants := drawScenario(t)
		a, err := ComputePostings(payer, total, rule, participants)
		if err != nil {
			t.Fatalf("valid scenario rejected: %v", err)
		}
		b, _ := ComputePostings(payer, total, rule, participants)
		if !reflect.DeepEqual(a, b) {
			t.Fatalf("non-deterministic: %v vs %v", a, b)
		}
		for i := 1; i < len(a); i++ {
			if bytes.Compare(a[i-1].MemberID[:], a[i].MemberID[:]) >= 0 {
				t.Fatalf("postings not sorted by member id: %v", a)
			}
		}
	})
}
```

- [ ] **Step 3: Run the property tests**

Run: `go test ./internal/ledger/ -v -run Property`
Expected: PASS (rapid runs 100 cases per property by default). If a property fails, rapid prints a minimal counterexample — fix `split.go`, not the test.

- [ ] **Step 4: Commit**

```bash
git add go.mod go.sum internal/ledger/property_test.go
git commit -m "test: property tests for zero-sum, determinism, participant coverage"
```

---

### Task 5: Schema migrations + test database plumbing

**Files:**
- Create: `docker-compose.yml`, `migrations/0001_init.up.sql`, `migrations/0001_init.down.sql`, `internal/store/store.go`
- Test: `internal/store/store_test.go`

**Interfaces:**
- Produces: `store.New(ctx context.Context, databaseURL string) (*Store, error)` (runs migrations, returns pool wrapper); `Store{Pool *pgxpool.Pool}`; `store.TestStore(t *testing.T) *Store` helper that skips without `TEST_DATABASE_URL` and truncates all tables.

- [ ] **Step 1: Write docker-compose and migrations**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: tallyup
      POSTGRES_PASSWORD: tallyup
      POSTGRES_DB: tallyup_test
    ports:
      - "5433:5432"
```

`migrations/0001_init.up.sql` (schema from `docs/architecture.md` §6, plus append-only trigger and the `after_seq` index):

```sql
CREATE TABLE members (
  id         UUID PRIMARY KEY,
  name       TEXT NOT NULL
);

CREATE TABLE groups (
  id         UUID PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id   UUID NOT NULL REFERENCES groups(id),
  member_id  UUID NOT NULL REFERENCES members(id),
  PRIMARY KEY (group_id, member_id)
);

CREATE TABLE entries (
  id           UUID PRIMARY KEY,
  seq          BIGSERIAL UNIQUE,
  group_id     UUID NOT NULL REFERENCES groups(id),
  kind         TEXT NOT NULL CHECK (kind IN ('expense','settlement','reversal')),
  reverses_id  UUID REFERENCES entries(id),
  payer_id     UUID NOT NULL REFERENCES members(id),
  counterparty UUID REFERENCES members(id),
  total_amount BIGINT NOT NULL CHECK (total_amount > 0),
  split_rule   JSONB NOT NULL,
  participants UUID[] NOT NULL,
  plan_seq     BIGINT,
  memo         TEXT,
  occurred_on  DATE NOT NULL,
  created_by   UUID NOT NULL REFERENCES members(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX entries_group_seq ON entries (group_id, seq);

CREATE TABLE postings (
  entry_id   UUID NOT NULL REFERENCES entries(id),
  member_id  UUID NOT NULL REFERENCES members(id),
  amount     BIGINT NOT NULL,
  PRIMARY KEY (entry_id, member_id)
);

CREATE TABLE idempotency_keys (
  key           UUID PRIMARY KEY,
  request_hash  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','succeeded')),
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE VIEW balances AS
SELECT e.group_id, p.member_id, SUM(p.amount) AS balance
FROM postings p JOIN entries e ON e.id = p.entry_id
GROUP BY e.group_id, p.member_id;

-- The ledger is append-only: row-level UPDATE/DELETE are forbidden.
-- (TRUNCATE bypasses row triggers, which keeps test resets possible.)
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only: % on % forbidden', TG_OP, TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER entries_append_only
  BEFORE UPDATE OR DELETE ON entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER postings_append_only
  BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
```

`migrations/0001_init.down.sql`:

```sql
DROP VIEW balances;
DROP TABLE idempotency_keys;
DROP TABLE postings;
DROP TABLE entries;
DROP TABLE group_members;
DROP TABLE groups;
DROP TABLE members;
DROP FUNCTION forbid_ledger_mutation();
```

- [ ] **Step 2: Write the failing test**

`internal/store/store_test.go`:

```go
package store

import (
	"context"
	"os"
	"testing"
)

func TestMigrationsApplyAndLedgerIsAppendOnly(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()

	// Seed a minimal group so we can insert an entry.
	// (One statement per Exec — pgx v5's extended protocol rejects batches.)
	for _, q := range []string{
		`INSERT INTO members (id, name) VALUES ('00000000-0000-0000-0000-00000000000a', 'yuto')`,
		`INSERT INTO groups (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'trip')`,
		`INSERT INTO group_members VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a')`,
		`INSERT INTO entries (id, group_id, kind, payer_id, total_amount, split_rule, participants, occurred_on, created_by)
		 VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'expense',
		         '00000000-0000-0000-0000-00000000000a', 1000, '{"type":"equal"}',
		         ARRAY['00000000-0000-0000-0000-00000000000a']::uuid[], '2026-07-05',
		         '00000000-0000-0000-0000-00000000000a')`,
	} {
		if _, err := s.Pool.Exec(ctx, q); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	// UPDATE and DELETE on the ledger must be rejected by the trigger.
	if _, err := s.Pool.Exec(ctx, `UPDATE entries SET memo = 'oops'`); err == nil {
		t.Fatal("UPDATE on entries should be forbidden")
	}
	if _, err := s.Pool.Exec(ctx, `DELETE FROM entries`); err == nil {
		t.Fatal("DELETE on entries should be forbidden")
	}
}

func TestTestStoreSkipsWithoutEnv(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("no TEST_DATABASE_URL; TestStore would skip too")
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/store/ -v`
Expected: compile FAIL — `undefined: TestStore`, `undefined: Store`.

- [ ] **Step 4: Implement the store**

```bash
go get github.com/jackc/pgx/v5@latest github.com/golang-migrate/migrate/v4@latest
```

`internal/store/store.go`:

```go
// Package store owns all Postgres access. Correctness-critical SQL lives here.
package store

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

**Note:** golang-migrate needs the migrations inside the package for `go:embed`, so copy them: `mkdir -p internal/store/migrations && cp migrations/*.sql internal/store/migrations/`. Keep `migrations/` at the repo root as the source of truth and treat `internal/store/migrations/` as the embedded copy (add a `//go:generate cp ../../migrations/*.sql migrations/` line if you like; for now the plan copies manually — there is exactly one migration).

- [ ] **Step 5: Start the database and run the tests**

```bash
docker compose up -d db
export TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable'
go test ./internal/store/ -v
```

Expected: PASS — migrations apply, trigger rejects UPDATE/DELETE.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml migrations/ internal/store/ go.mod go.sum
git commit -m "feat: schema migrations, append-only trigger, store scaffolding"
```

---

### Task 6: Idempotency gate (pending-row-first) + janitor sweep

**Files:**
- Create: `internal/store/idempotency.go`
- Test: `internal/store/idempotency_test.go`

**Interfaces:**
- Consumes: `Store`, `TestStore` from Task 5.
- Produces:
  - `type GateResult int` with `GateProceed`, `GateReplay`, `GateInFlight`, `GateMismatch`
  - `(*Store) AcquireIdempotencyKey(ctx context.Context, key uuid.UUID, requestHash string) (GateResult, []byte, error)` — second return is the stored response body, non-nil only for `GateReplay`.
  - `(*Store) SweepStalePending(ctx context.Context, olderThan time.Duration) (int64, error)` — deletes stale pending rows, returns count.
  - `(*Store) ReleaseIdempotencyKey(ctx context.Context, key uuid.UUID) error` — deletes a *pending* row so the client can retry immediately after a post-gate failure (without this, a failed write blocks retries until the janitor sweeps).

- [ ] **Step 1: Write the failing tests**

`internal/store/idempotency_test.go`:

```go
package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestGate_FreshKeyProceeds(t *testing.T) {
	s := TestStore(t)
	res, _, err := s.AcquireIdempotencyKey(context.Background(), uuid.New(), "hash1")
	if err != nil {
		t.Fatal(err)
	}
	if res != GateProceed {
		t.Fatalf("got %v, want GateProceed", res)
	}
}

func TestGate_DuplicatePendingIsInFlight(t *testing.T) {
	s := TestStore(t)
	key := uuid.New()
	ctx := context.Background()
	s.AcquireIdempotencyKey(ctx, key, "hash1")
	res, _, err := s.AcquireIdempotencyKey(ctx, key, "hash1")
	if err != nil {
		t.Fatal(err)
	}
	if res != GateInFlight {
		t.Fatalf("got %v, want GateInFlight", res)
	}
}

func TestGate_SucceededKeyReplaysStoredResponse(t *testing.T) {
	s := TestStore(t)
	key := uuid.New()
	ctx := context.Background()
	s.AcquireIdempotencyKey(ctx, key, "hash1")
	_, err := s.Pool.Exec(ctx,
		`UPDATE idempotency_keys SET status='succeeded', response_body='{"id":"x","seq":1}' WHERE key=$1`, key)
	if err != nil {
		t.Fatal(err)
	}
	res, body, err := s.AcquireIdempotencyKey(ctx, key, "hash1")
	if err != nil {
		t.Fatal(err)
	}
	if res != GateReplay {
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
	s.AcquireIdempotencyKey(ctx, key, "hash1")
	res, _, err := s.AcquireIdempotencyKey(ctx, key, "DIFFERENT")
	if err != nil {
		t.Fatal(err)
	}
	if res != GateMismatch {
		t.Fatalf("got %v, want GateMismatch", res)
	}
}

func TestSweepStalePending(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()
	stale, fresh := uuid.New(), uuid.New()
	s.AcquireIdempotencyKey(ctx, stale, "h")
	s.AcquireIdempotencyKey(ctx, fresh, "h")
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
	if res, _, _ := s.AcquireIdempotencyKey(ctx, stale, "h"); res != GateProceed {
		t.Fatalf("stale key after sweep: got %v, want GateProceed", res)
	}
	if res, _, _ := s.AcquireIdempotencyKey(ctx, fresh, "h"); res != GateInFlight {
		t.Fatalf("fresh key after sweep: got %v, want GateInFlight", res)
	}
}

func TestReleaseIdempotencyKey_PendingOnly(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()

	// A released pending key can be re-acquired immediately.
	key := uuid.New()
	s.AcquireIdempotencyKey(ctx, key, "h")
	if err := s.ReleaseIdempotencyKey(ctx, key); err != nil {
		t.Fatal(err)
	}
	if res, _, _ := s.AcquireIdempotencyKey(ctx, key, "h"); res != GateProceed {
		t.Fatalf("after release: got %v, want GateProceed", res)
	}

	// A succeeded key must never be released — the response snapshot is truth.
	done := uuid.New()
	s.AcquireIdempotencyKey(ctx, done, "h")
	if _, err := s.Pool.Exec(ctx,
		`UPDATE idempotency_keys SET status='succeeded', response_body='{}' WHERE key=$1`, done); err != nil {
		t.Fatal(err)
	}
	if err := s.ReleaseIdempotencyKey(ctx, done); err != nil {
		t.Fatal(err)
	}
	if res, _, _ := s.AcquireIdempotencyKey(ctx, done, "h"); res != GateReplay {
		t.Fatalf("succeeded key survived release: got %v, want GateReplay", res)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/store/ -v -run 'Gate|Sweep'`
Expected: compile FAIL — `undefined: GateProceed`, etc.

- [ ] **Step 3: Implement**

`internal/store/idempotency.go`:

```go
package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type GateResult int

const (
	GateProceed  GateResult = iota // this request owns the operation
	GateReplay                     // already succeeded; return stored body
	GateInFlight                   // another request holds a pending row
	GateMismatch                   // same key, different payload — client bug
)

// AcquireIdempotencyKey implements the pending-row-first gate from
// architecture.md §4. The pending insert commits immediately (its own
// implicit txn) so a crash leaves a visible pending row for the janitor.
func (s *Store) AcquireIdempotencyKey(ctx context.Context, key uuid.UUID, requestHash string) (GateResult, []byte, error) {
	ct, err := s.Pool.Exec(ctx,
		`INSERT INTO idempotency_keys (key, request_hash, status) VALUES ($1, $2, 'pending')
		 ON CONFLICT (key) DO NOTHING`, key, requestHash)
	if err != nil {
		return 0, nil, err
	}
	if ct.RowsAffected() == 1 {
		return GateProceed, nil, nil
	}

	var storedHash, status string
	var body []byte
	err = s.Pool.QueryRow(ctx,
		`SELECT request_hash, status, COALESCE(response_body, 'null'::jsonb)
		 FROM idempotency_keys WHERE key = $1`, key).Scan(&storedHash, &status, &body)
	if errors.Is(err, pgx.ErrNoRows) {
		// Janitor deleted the row between our insert-conflict and this read;
		// tell the client to retry rather than racing to re-own it here.
		return GateInFlight, nil, nil
	}
	if err != nil {
		return 0, nil, err
	}
	if storedHash != requestHash {
		return GateMismatch, nil, nil
	}
	if status == "succeeded" {
		return GateReplay, body, nil
	}
	return GateInFlight, nil, nil
}

// ReleaseIdempotencyKey frees a pending key after a post-gate failure so the
// client can retry immediately instead of waiting for the janitor. Succeeded
// keys are never released: their response snapshot is the replay truth.
func (s *Store) ReleaseIdempotencyKey(ctx context.Context, key uuid.UUID) error {
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/store/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/store/
git commit -m "feat: pending-row-first idempotency gate and stale-pending sweep"
```

---

### Task 7: Write path — CreateEntry + HTTP handler

**Files:**
- Create: `internal/store/entries.go`, `internal/api/server.go`, `internal/api/entries.go`
- Test: `internal/api/entries_test.go`

**Interfaces:**
- Consumes: `ledger.ComputePostings`, `ledger.SettlementPostings`, `store.AcquireIdempotencyKey`, `store.TestStore`.
- Produces:
  - `store.EntryInput{ID uuid.UUID; GroupID uuid.UUID; Kind string; PayerID uuid.UUID; Counterparty *uuid.UUID; TotalAmount int64; SplitRule []byte; Participants []uuid.UUID; Memo string; OccurredOn time.Time; CreatedBy uuid.UUID}`
  - `(*Store) CreateEntry(ctx context.Context, key uuid.UUID, in EntryInput, postings []ledger.Posting) (respBody []byte, err error)` — one txn: membership check, insert entry + postings, mark key succeeded with `{"id":"…","seq":N}`. Sentinel errors: `store.ErrNotGroupMembers`, `store.ErrDuplicateEntryID`.
  - `api.NewServer(s *store.Store) http.Handler` routing `POST /groups/{group_id}/entries`.
- HTTP contract: `201` + `{"id":…,"seq":N}` on first success; `200` + stored body on replay; `409` in-flight or duplicate entry id; `422` hash mismatch / validation failure; `400` malformed input. `Idempotency-Key` header (UUID) required.

- [ ] **Step 1: Write the failing integration tests**

`internal/api/entries_test.go`:

```go
package api

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

	"tallyup/internal/store"
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
func seedGroup(t *testing.T, s *store.Store) {
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

func newTestServer(t *testing.T) (*httptest.Server, *store.Store) {
	s := store.TestStore(t)
	seedGroup(t, s)
	srv := httptest.NewServer(NewServer(s))
	t.Cleanup(srv.Close)
	return srv, s
}

func TestCreateExpense_HappyPath(t *testing.T) {
	srv, s := newTestServer(t)
	resp, body := post(t, srv, uuid.New(), expenseBody(uuid.New()))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s", resp.StatusCode, body)
	}
	var sum int64
	if err := s.Pool.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(amount),0) FROM postings`).Scan(&sum); err != nil {
		t.Fatal(err)
	}
	if sum != 0 {
		t.Fatalf("postings sum %d, want 0", sum)
	}
	var n int
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d entries, want 1", n)
	}
}

func TestCreateExpense_ReplaySameKeySameBody(t *testing.T) {
	srv, s := newTestServer(t)
	key, body := uuid.New(), expenseBody(uuid.New())
	resp1, body1 := post(t, srv, key, body)
	resp2, body2 := post(t, srv, key, body)
	if resp1.StatusCode != http.StatusCreated || resp2.StatusCode != http.StatusOK {
		t.Fatalf("statuses %d/%d, want 201/200", resp1.StatusCode, resp2.StatusCode)
	}
	if !bytes.Equal(body1, body2) {
		t.Fatalf("replay body differs: %s vs %s", body1, body2)
	}
	var n int
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d entries after replay, want 1", n)
	}
}

func TestCreateExpense_SameKeyDifferentBodyIs422(t *testing.T) {
	srv, _ := newTestServer(t)
	key := uuid.New()
	post(t, srv, key, expenseBody(uuid.New()))
	resp, _ := post(t, srv, key, expenseBody(uuid.New())) // different entry id → different bytes
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422", resp.StatusCode)
	}
}

func TestCreateExpense_NonMemberParticipantIs422(t *testing.T) {
	srv, _ := newTestServer(t)
	outsider := uuid.New()
	b, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "kind": "expense", "payer_id": yuto,
		"total_amount": 1000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, outsider},
		"occurred_on":  "2026-07-05",
	})
	resp, _ := post(t, srv, uuid.New(), b)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422", resp.StatusCode)
	}
}

func TestCreateSettlement(t *testing.T) {
	srv, s := newTestServer(t)
	b, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "kind": "settlement", "payer_id": memA,
		"counterparty": yuto, "total_amount": 4000, "occurred_on": "2026-07-05",
	})
	resp, body := post(t, srv, uuid.New(), b)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s", resp.StatusCode, body)
	}
	var amt int64
	err := s.Pool.QueryRow(context.Background(),
		`SELECT amount FROM postings WHERE member_id=$1`, memA).Scan(&amt)
	if err != nil || amt != 4000 {
		t.Fatalf("payer posting %d (err %v), want +4000", amt, err)
	}
}

func TestPostGateFailureReleasesKey_RetryProceeds(t *testing.T) {
	srv, _ := newTestServer(t)
	key := uuid.New()
	outsider := uuid.New()
	bad, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "kind": "expense", "payer_id": yuto,
		"total_amount": 1000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, outsider},
		"occurred_on":  "2026-07-05",
	})
	resp, _ := post(t, srv, key, bad)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422", resp.StatusCode)
	}
	// The key was released, so a corrected request with the same key succeeds
	// immediately — no waiting for the janitor.
	resp, body := post(t, srv, key, expenseBody(uuid.New()))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("corrected retry: status %d, body %s", resp.StatusCode, body)
	}
}

func TestMissingIdempotencyKeyIs400(t *testing.T) {
	srv, _ := newTestServer(t)
	req, _ := http.NewRequest("POST", srv.URL+fmt.Sprintf("/groups/%s/entries", gID),
		bytes.NewReader(expenseBody(uuid.New())))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", resp.StatusCode)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/api/ -v`
Expected: compile FAIL — `undefined: NewServer`, `store.CreateEntry` missing.

- [ ] **Step 3: Implement CreateEntry**

`internal/store/entries.go`:

```go
package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"tallyup/internal/ledger"
)

var (
	ErrNotGroupMembers  = errors.New("payer, counterparty, and participants must all be group members")
	ErrDuplicateEntryID = errors.New("entry id already exists")
)

type EntryInput struct {
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

// CreateEntry runs the write path's single transaction: membership check,
// entry + postings insert, and marking the idempotency key succeeded with the
// response snapshot. postings must already sum to zero (asserted here too).
func (s *Store) CreateEntry(ctx context.Context, key uuid.UUID, in EntryInput, postings []ledger.Posting) ([]byte, error) {
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
		return nil, ErrNotGroupMembers
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
		return nil, ErrDuplicateEntryID
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

- [ ] **Step 4: Implement the HTTP layer**

`internal/api/server.go`:

```go
// Package api is the thin HTTP layer: decode, validate, gate, one store call.
package api

import (
	"net/http"

	"tallyup/internal/store"
)

type Server struct {
	store *store.Store
}

func NewServer(s *store.Store) http.Handler {
	srv := &Server{store: s}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /groups/{group_id}/entries", srv.handleCreateEntry)
	return mux
}
```

`internal/api/entries.go`:

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
	"time"

	"github.com/google/uuid"

	"tallyup/internal/ledger"
	"tallyup/internal/store"
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

	// Compute postings before the gate: pure validation, no DB cost.
	var postings []ledger.Posting
	var splitJSON []byte
	participants := req.Participants
	switch req.Kind {
	case "expense":
		postings, err = ledger.ComputePostings(req.PayerID, req.TotalAmount, req.SplitRule, req.Participants)
		if err == nil {
			splitJSON, err = json.Marshal(req.SplitRule)
		}
	case "settlement":
		if req.Counterparty == nil {
			httpError(w, http.StatusBadRequest, "settlement requires counterparty")
			return
		}
		postings, err = ledger.SettlementPostings(req.PayerID, *req.Counterparty, req.TotalAmount)
		splitJSON = []byte(`{"type":"settlement"}`)
		participants = []uuid.UUID{req.PayerID, *req.Counterparty}
	default:
		httpError(w, http.StatusBadRequest, "kind must be expense or settlement")
		return
	}
	if err != nil {
		httpError(w, http.StatusUnprocessableEntity, err.Error())
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

	resp, err := s.store.CreateEntry(r.Context(), key, store.EntryInput{
		ID: req.ID, GroupID: groupID, Kind: req.Kind, PayerID: req.PayerID,
		Counterparty: req.Counterparty, TotalAmount: req.TotalAmount,
		SplitRule: splitJSON, Participants: participants, Memo: req.Memo,
		OccurredOn: occurredOn, CreatedBy: req.PayerID,
	}, postings)
	if err != nil {
		// We own the pending row; free it so the client's retry isn't stuck
		// behind the janitor. Best-effort — the janitor is the backstop.
		if relErr := s.store.ReleaseIdempotencyKey(r.Context(), key); relErr != nil {
			slog.Warn("release idempotency key", "key", key, "err", relErr)
		}
	}
	switch {
	case errors.Is(err, store.ErrNotGroupMembers):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, store.ErrDuplicateEntryID):
		httpError(w, http.StatusConflict, err.Error())
	case err != nil:
		httpError(w, http.StatusInternalServerError, "write failed")
	default:
		writeJSON(w, http.StatusCreated, resp)
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

**Why `RETURNING response_body` in CreateEntry:** Postgres normalizes JSONB formatting (it inserts spaces: `{"id": "x", "seq": 1}`). If the 201 response used our raw bytes but replays read back from JSONB, they would differ. Returning the stored JSONB from the UPDATE means first response and every replay emit identical bytes — invariant 2 holds literally.

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/api/ ./internal/store/ ./internal/ledger/ -v`
Expected: PASS (with `TEST_DATABASE_URL` exported and docker compose db up).

- [ ] **Step 6: Commit**

```bash
git add internal/store/entries.go internal/api/
git commit -m "feat: idempotent entry write path with membership validation"
```

---

### Task 8: main.go — wiring, janitor goroutine, graceful shutdown

**Files:**
- Create: `cmd/api/main.go`

**Interfaces:**
- Consumes: `store.New`, `store.SweepStalePending`, `api.NewServer`.
- Env: `DATABASE_URL` (required), `PORT` (default `8080`).
- Janitor cadence: sweep every 30s, expire pendings older than 60s.

- [ ] **Step 1: Implement**

`cmd/api/main.go`:

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

	"tallyup/internal/api"
	"tallyup/internal/store"
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

	s, err := store.New(ctx, dbURL)
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

	srv := &http.Server{Addr: ":" + port, Handler: api.NewServer(s)}
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

- [ ] **Step 2: Verify it builds and boots against the dev DB**

```bash
go build ./...
DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' PORT=8081 go run ./cmd/api &
sleep 1
curl -s -X POST http://localhost:8081/groups/00000000-0000-0000-0000-0000000000a1/entries \
  -H "Idempotency-Key: $(uuidgen)" -d '{}' ; echo
kill %1
```

Expected: a JSON error response (400 — invalid entry payload), proving routing + gate wiring work end-to-end.

- [ ] **Step 3: Commit**

```bash
git add cmd/
git commit -m "feat: api binary with janitor goroutine and graceful shutdown"
```

---

### Task 9: Chaos test — 50 concurrent identical requests

**Files:**
- Test: `internal/api/entries_test.go` (append)

**Interfaces:**
- Consumes: everything from Tasks 5–7.

- [ ] **Step 1: Write the concurrency tests**

Append to `internal/api/entries_test.go`:

```go
func TestConcurrency_SameKey50x_ExactlyOneEntry(t *testing.T) {
	srv, s := newTestServer(t)
	key, body := uuid.New(), expenseBody(uuid.New())

	const workers = 50
	statuses := make(chan int, workers)
	for i := 0; i < workers; i++ {
		go func() {
			resp, _ := post(t, srv, key, body)
			statuses <- resp.StatusCode
		}()
	}
	counts := map[int]int{}
	for i := 0; i < workers; i++ {
		counts[<-statuses]++
	}

	// Exactly one 201; everything else replayed (200) or bounced in-flight (409).
	if counts[201] != 1 {
		t.Fatalf("got %d 201s, want exactly 1 (all statuses: %v)", counts[201], counts)
	}
	if counts[201]+counts[200]+counts[409] != workers {
		t.Fatalf("unexpected statuses: %v", counts)
	}

	var n int
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d entries, want exactly 1", n)
	}

	// A 409 client retries and must eventually get the replay.
	resp, _ := post(t, srv, key, body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("retry after storm: status %d, want 200", resp.StatusCode)
	}
}

func TestConcurrency_DistinctKeys50x_AllLand(t *testing.T) {
	srv, s := newTestServer(t)

	const workers = 50
	done := make(chan struct{}, workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			resp, body := post(t, srv, uuid.New(), expenseBody(uuid.New()))
			if resp.StatusCode != http.StatusCreated {
				t.Errorf("status %d, body %s", resp.StatusCode, body)
			}
		}()
	}
	for i := 0; i < workers; i++ {
		<-done
	}

	var n int
	var sum int64
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries`).Scan(&n)
	s.Pool.QueryRow(context.Background(), `SELECT COALESCE(SUM(amount),0) FROM postings`).Scan(&sum)
	if n != workers {
		t.Fatalf("%d entries, want %d", n, workers)
	}
	if sum != 0 {
		t.Fatalf("global postings sum %d, want 0", sum)
	}
}
```

- [ ] **Step 2: Run with the race detector**

Run: `go test ./internal/api/ -v -race -run Concurrency`
Expected: PASS, no data races. The same-key test proves invariant 2 (at most one entry per key) under a genuine retry storm; the distinct-keys test proves invariant 6 (no lost or duplicated concurrent adds) and invariant 1 (global zero-sum).

- [ ] **Step 3: Run the full suite one last time**

Run: `go test ./... -race`
Expected: PASS across all packages.

- [ ] **Step 4: Commit**

```bash
git add internal/api/entries_test.go
git commit -m "test: concurrency chaos tests for idempotency and zero-sum invariants"
```

---

## Deferred to follow-up plans

- **Reads** (balance endpoint, `after_seq` history, explain-this-balance) — architecture Phase 3.
- **Reversals** (delete/edit with row-lock against double-reversal) — Phase 4.
- **Next.js client** — Phase 5.
- **Settle-up plan** (greedy transfers, snapshot-seq optimistic check) — Phase 6.
- **Outbox + notifications, SSE** — v1.1.
- Group/member management endpoints (tests seed directly for now; the client plan needs a create-group + invite-link flow first).
