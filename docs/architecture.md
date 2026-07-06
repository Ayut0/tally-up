# tally-up — Architecture Draft

A bill splitter for friend groups (trips, dinners, gatherings — n people, not just two) with **strong consistency** and **idempotency** as first-class design goals. Balances must be provably correct at all times, across many phones, over flaky mobile networks, with retries.

> Design principle: the ledger is the truth. Everything else is derived and disposable.

---

## 1. Goals & Non-Goals

### Goals
- **Correctness over features.** "Who owes whom" is always explainable by replaying the ledger.
- **Idempotent writes.** Double-taps, client retries, and at-least-once delivery never double-count an expense.
- **Strong consistency.** One authoritative source of truth (Postgres primary). Every read reflects all prior committed writes.
- **Uneven splits as a core feature.** Equal, exact amounts, shares, percentages — modeled explicitly per entry.
- **Partial participation.** Not everyone joins every expense (someone skips dinner, someone leaves the trip early). Each entry names its participants.
- **Settle-up plans.** With n people, "who pays whom" is a graph problem — the app proposes a minimal set of transfers.
- **Auditability.** Append-only ledger. Edits and deletes are reversing entries, never mutations.

### Non-Goals (v1)
- Offline-first multi-device merging (CRDTs / eventual consistency). Deliberately out of scope — single-primary strong consistency is the chosen trade-off. Can be revisited as a "part 2".
- Multi-currency (v1 is JPY, integer yen — no floating point money).
- Receipt OCR, payment execution (this tracks debts; it doesn't move money).

---

## 2. System Overview

```
┌──────────────┐        HTTPS (retry w/ same idempotency key)
│  Browser A   │──────────────────┐
│ (Next.js)    │                  ▼
└──────────────┘         ┌─────────────────┐       ┌──────────────────┐
                         │  API (Go)        │──────▶│ Postgres (Neon)  │
┌──────────────┐         │                 │       │  - entries (log) │
│  Browser B…n │────────▶│  - auth          │       │  - idempotency   │
│ (phones too) │         │  - validation    │       │  - balances (mv) │
└──────────────┘         │  - idempotency   │       └──────────────────┘
                                  │
                                  ▼ (outbox relay goroutine, v1.1)
                         ┌─────────────────┐
                         │ Notifications    │  Pushover / Discord
                         └─────────────────┘
```

- **Client:** Next.js web app (App Router), mobile-first responsive UI. At a gathering everyone just opens a link in their phone browser — no install, which fits the friend-group use case better than a native app anyway.
- **Idempotency on the web client:** mint a UUIDv7 key when the user taps **Add** (component state), reuse it on every retry of that intent, discard on confirmed success. One web-specific caveat: a full page reload loses in-flight state, so the entry `id` itself (client-generated, unique in the DB) is the backstop against re-submission after reload.
- **API:** Go service. Thin: validate → idempotency gate → single `pgx` transaction → respond. The outbox relay and idempotency janitor run as goroutines in the same binary (see §8).
- **DB:** Postgres (Neon) is the single source of truth. All correctness lives here.
- **Sharing model (web-specific):** groups are joined via invite link — the natural web flow for a gathering. Auth starts as a signed group token in the URL or magic-link; upgrade later if it ever needs to.
- **Freshness (web-specific):** other members' expenses should show up without manual refresh. v1: poll `GET /entries?after_seq=N` every few seconds while the tab is visible — `seq` makes incremental fetch trivial and cheap. v1.1: upgrade to SSE for push. This replaces what push notifications would have done in a native app.
- **Notifications (v1.1):** outbox table + relay poller → Pushover/Discord ("A added ¥3,200 — dinner").

---

## 3. Core Model: Append-Only Double-Entry Ledger

### Why a ledger, not a balance
- A stored balance can silently drift; a derived balance cannot lie.
- Every number is explainable: fold over entries to reproduce it.
- Corrections are **new reversing entries** — history is never rewritten.
- Double-entry invariant: **the sum of all postings across all members is always zero.** Assert this in tests and in a periodic integrity check.

### Entry anatomy
An *entry* is one economic event (an expense or a settlement). It expands into *postings* — one per **participant** — that sum to zero. Participants are a subset of the group: the entry explicitly names who shared this expense.

Example: 4-person trip. Yuto pays ¥12,000 for dinner, but only Yuto, A, and B ate (C skipped). Equal split among the three participants:

| member | amount (¥) | meaning                                  |
|--------|-----------:|------------------------------------------|
| Yuto   |     +8,000 | paid 12,000, consumed 4,000 → net +8,000 |
| A      |     −4,000 | owes                                     |
| B      |     −4,000 | owes                                     |
| C      |     (none) | not a participant — no posting           |

Balance = `SUM(amount) GROUP BY member`. Positive = is owed; negative = owes. Note the model stores **net positions**, not pairwise debts — A owes "the group" ¥4,000, not "Yuto" specifically. This is a deliberate choice (see §5b: settlement) that makes the ledger simple and makes minimal-transfer settlement possible.

### Split rules (the uneven-split feature)
Stored on the entry alongside the **participant list**, applied at write time to compute postings:

- `equal` — even split across the entry's participants (not the whole group)
- `exact` — explicit amount per participant (must sum to total)
- `shares` — ratio-based (e.g. 2:2:1 — couples vs. singles on hotel rooms)
- `percent` — percentage-based (must sum to 100)

**Rounding rule (important):** amounts are integer yen. With n participants, remainders are real (¥10,000 / 3). Assign the remainder yen by a fixed, documented, deterministic rule (e.g. largest-remainder method, ties broken by member id) so postings always sum exactly to zero and the same input always yields the same postings. Never floats.

### Edits & deletes
- **Delete** = append a reversing entry (negated postings) referencing the original.
- **Edit** = reversal + new entry, atomically in one transaction.
- The UI can render this as a simple "edited" state; the ledger underneath stays append-only.

---

## 4. Idempotency Design

### Client contract
- Client mints `idempotency_key` (UUIDv7) when the user taps **Add** — not per HTTP attempt.
- Every retry of that intent reuses the same key.
- Server guarantees: same key + same payload → same result, exactly one ledger entry.

### Server algorithm (pending-row-first)
1. `INSERT INTO idempotency_keys (key, request_hash, status='pending')`
   - **Success** → this request owns the operation; proceed.
   - **Unique violation** → duplicate:
     - stored `status='succeeded'` → return the stored response (replay).
     - stored `status='pending'` → return `409 Conflict` ("in flight, retry shortly").
     - stored `request_hash` ≠ incoming hash → `422` (same key, different payload — client bug; never return the cached result).
2. In the **same transaction**: insert entry + postings, assert zero-sum, update idempotency row to `succeeded` with the response snapshot.
3. Commit. Respond.

Crash between steps? The pending row exists but no entry — a janitor job expires stale `pending` rows older than a timeout so the client can retry cleanly.

Two refinements found while planning the implementation:
- **Release on post-gate failure.** If validation fails *after* the gate acquired the key (e.g. a non-member participant), delete the pending row immediately — otherwise the client's corrected retry is stuck behind the janitor. Succeeded rows are never released; their response snapshot is the replay truth.
- **Replay bytes come from the DB.** Postgres normalizes JSONB formatting, so the first response must also be read back from the stored `response_body` (`UPDATE … RETURNING`) — that is what makes "byte-identical response" hold literally between the first response and every replay.

### What this kills
- Double-tap on a slow connection.
- HTTP retry after a timeout where the first request actually succeeded.
- Any at-least-once client behavior.

---

## 5. Consistency Design

### The key insight: most operations commute
Adding expenses is **additive and commutative** — concurrent adds from both phones can never conflict; the final balance is order-independent. On a single Postgres primary, plain `READ COMMITTED` is sufficient for the entire add path.

Consistency only *bites* where operations **read then write** against current state:

| operation | commutes? | mechanism |
|---|---|---|
| add expense | yes | plain transaction, no locks |
| add settlement (unconstrained) | yes | plain transaction |
| settlement with "cannot overpay" invariant | **no** | `SELECT … FOR UPDATE` on the group row, or `SERIALIZABLE` |
| edit / delete (reversal referencing original) | **no** | row lock on the original entry to prevent double-reversal |
| balance read | n/a | consistent read on primary; derived view |

### Total order & audit
- `entries.seq BIGSERIAL` gives a total order for replay and audit.
- Balances are a **derived view** (or a materialized cache): it must always be safe to `TRUNCATE` the cache and rebuild from entries. If it isn't, the design has drifted — this property is the design's smoke test.

### 5b. Settlement with n people: the transfer plan
Because the ledger stores **net positions**, settling up is: partition members into creditors (balance > 0) and debtors (balance < 0), then propose transfers that zero everyone out with a minimal number of payments. The greedy algorithm (repeatedly match the largest debtor with the largest creditor) yields at most *n − 1* transfers and is what Splitwise-style "simplify debts" does. Truly minimal transfer count is NP-hard (subset-sum), so greedy is the documented, good-enough choice.

Design decisions that follow:
- A **settle-up plan is a read-model artifact**, not ledger truth. The ledger only records settlements that actually happened (`kind='settlement'`: X paid Y ¥Z, postings +Z/−Z).
- The plan is computed against a balance snapshot. Between proposing a plan and recording a payment, new expenses may land — so a recorded settlement **references the snapshot `seq`** it was computed at. If the balance moved, the app recomputes and re-proposes rather than enforcing a stale plan. This is a clean, small example of optimistic concurrency.
- Partial settlements are fine: any settlement entry just shifts net positions; the ledger stays consistent regardless of whether people follow the proposed plan.

### Integrity checks (cheap, run nightly or on demand)
- Global zero-sum: `SELECT SUM(amount) FROM postings` = 0.
- Per-entry zero-sum: no entry whose postings don't sum to 0.
- Every reversal references exactly one non-reversed original.

---

## 6. Data Model (Draft DDL)

All IDs are UUIDv7 (time-ordered), generated in application code — Go's
`uuid.NewV7()` (client-generated entries/groups still arrive with an ID
already set; server-generated ones like a new member get one minted before
insert) and the client's `uuidv7()` helper (browsers have no native v7
generator). No `DEFAULT` on `id` columns: every insert supplies one
explicitly, so there's no code path that could silently fall back to a
different UUID version.

```sql
-- People & groups (v1: a group of two, but modeled generally)
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
  group_id   UUID REFERENCES groups(id),
  member_id  UUID REFERENCES members(id),
  PRIMARY KEY (group_id, member_id)
);

-- The ledger: append-only. No UPDATE, no DELETE (enforce via permissions/trigger).
CREATE TABLE entries (
  id           UUID PRIMARY KEY,             -- client-generated (doubles as idempotent create id)
  seq          BIGSERIAL UNIQUE,             -- total order for replay/audit
  group_id     UUID NOT NULL REFERENCES groups(id),
  kind         TEXT NOT NULL CHECK (kind IN ('expense','settlement','reversal')),
  reverses_id  UUID REFERENCES entries(id),  -- set iff kind='reversal'
  payer_id     UUID NOT NULL REFERENCES members(id),
  counterparty UUID REFERENCES members(id),  -- set iff kind='settlement' (who was paid)
  total_amount BIGINT NOT NULL,              -- integer yen; sign conventions documented
  split_rule   JSONB NOT NULL,               -- {type:'equal'} | {type:'exact',amounts:{...}} | shares | percent
  participants UUID[] NOT NULL,              -- subset of group members sharing this entry
  plan_seq     BIGINT,                       -- for settlements: balance snapshot the plan was computed at
  memo         TEXT,
  occurred_on  DATE NOT NULL,
  created_by   UUID NOT NULL REFERENCES members(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per member per entry; the double-entry postings.
CREATE TABLE postings (
  entry_id   UUID NOT NULL REFERENCES entries(id),
  member_id  UUID NOT NULL REFERENCES members(id),
  amount     BIGINT NOT NULL,                -- signed yen; entry's postings sum to 0
  PRIMARY KEY (entry_id, member_id)
);

-- Idempotency gate.
CREATE TABLE idempotency_keys (
  key           UUID PRIMARY KEY,
  request_hash  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','succeeded')),
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Derived balance (view; can be materialized later without changing semantics).
CREATE VIEW balances AS
SELECT e.group_id, p.member_id, SUM(p.amount) AS balance
FROM postings p JOIN entries e ON e.id = p.entry_id
GROUP BY e.group_id, p.member_id;
```

Notes:
- `entries.id` is client-generated, so the entry id itself is a second idempotency layer (unique-violation on replay even if the key table were lost).
- Append-only is enforced, not hoped for: revoke `UPDATE/DELETE` on `entries`/`postings` from the app role, or add a `BEFORE UPDATE OR DELETE` trigger that raises.

---

## 7. API Sketch

```
POST   /groups/:id/entries        # add expense or settlement
       headers: Idempotency-Key: <uuid>
       body: { id, kind, payer_id, total_amount, split_rule, memo, occurred_on }

POST   /groups/:id/entries/:eid/reverse    # delete (append reversal)
PUT    /groups/:id/entries/:eid            # edit = reverse + create, one txn
GET    /groups/:id/balance                 # derived net balances, all members
GET    /groups/:id/settle-plan             # proposed minimal transfers + snapshot seq
GET    /groups/:id/entries?after_seq=N     # paginated ledger (audit/history UI)
```

Write-path shape (one transaction):
```
validate payload
→ idempotency gate (pending-row-first)
→ compute postings from split_rule (assert zero-sum)
→ insert entry + postings
→ (v1.1) insert outbox row for notification
→ mark idempotency key succeeded + snapshot response
→ COMMIT
```

---

## 8. Stack

| layer | choice | why |
|---|---|---|
| client | Next.js (App Router), mobile-first responsive | your strongest stack; invite-link flow fits web; no install for friends |
| API | **Go** (`net/http` + chi or stdlib router) | steady tail latency; goroutines fit the relay/janitor; the Go artifact you want for Datadog/Cloudflare-shaped roles |
| DB access | `pgx` + `sqlc` | typed queries, full control of transactions and locking — no ORM between you and the isolation semantics |
| DB | Postgres on Neon, **same region as the API** (`ap-northeast-1`) | single primary = the strong-consistency choice; co-location dominates latency at this scale |
| migrations | `golang-migrate` or `atlas` | plain SQL files; the schema *is* the design |
| freshness | polling `after_seq` → SSE (v1.1) | cheap incremental fetch rides the ledger's `seq` for free; SSE is trivial in Go |
| notifications | outbox table + relay goroutine → Pushover/Discord | at-least-once outbound, idempotent receiver |

**Why Go over TS here (recorded honestly):** not latency — at this scale, API↔DB region placement dominates and the language runtime is noise. The real reasons: (1) the outbox relay and idempotency janitor are long-running loops, which are natural goroutines with `time.Ticker` inside the same binary — no separate worker deploy; (2) predictable p99 without warmup; (3) this is the Go production artifact the target job search wants. Single static binary, one process, deploy anywhere (Fly.io / Railway / a VPS in Tokyo).

**Deploy shape:** Go API binary (HTTP server + relay + janitor goroutines, graceful shutdown draining in-flight transactions) + Next.js frontend deployed separately. The clean boundary is also the better system-design story.

---

## 9. Build Phases

1. **Ledger core (Go package)** — `internal/ledger`: postings computation for all four split rules, zero-sum + determinism property tests (`testing/quick` or `rapid`). *(The correctness heart. A pure package with tests, before any HTTP or DB.)*
2. **Write path + idempotency** — HTTP handler, `pgx` transaction, pending-row-first gate, janitor goroutine for stale pendings. Test: fire the same request 50× concurrently → exactly one entry.
3. **Reads** — balance view, ledger history endpoint, "explain this balance" (replay).
4. **Reversals** — delete/edit as reversing entries, with the row-lock against double-reversal.
5. **Client** — Next.js app: invite-link join, add expense (key minted at tap), balance screen, history; polling for freshness.
6. **Settle-up** — greedy transfer-plan algorithm, plan-vs-snapshot optimistic check, settlement entries; optional cannot-overpay under `FOR UPDATE`.
7. **(v1.1) Outbox + notifications** — relay goroutine (Ticker poll of outbox) → Pushover/Discord.
8. **Chaos pass** — kill the API mid-transaction, retry storms, duplicate keys with mutated payloads; verify invariants hold.

Each phase ends with something demonstrable, and phases 1–2 alone already deliver the strong-consistency + idempotency core you named.

---

## 10. Invariants (the test suite's spine)

1. Sum of all postings, globally and per entry, is **zero**. Always.
2. Same idempotency key + same payload → at most **one** entry, byte-identical response.
3. Same key + different payload → rejected, never a silently wrong replay.
4. Balances view can be dropped and rebuilt from entries with identical results.
5. An entry is reversed at most once.
6. Concurrent adds from any number of members never lose or duplicate an entry.
7. Postings exist only for an entry's declared participants **plus its payer** (and counterparty, for settlements) — the payer needs a posting even when not sharing the expense; all of them ⊆ group members.
8. The split computation is deterministic: same entry input → byte-identical postings (rounding included).
9. Executing a proposed settle plan in full drives every balance to exactly zero.

If all nine hold under the chaos pass, the system is doing its job.
