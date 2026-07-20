# 1. Scope of tactical DDD: structural packages + domain-service validation, no rich aggregates

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Yuto
- **Related:** Issue #59, PR #60 (structural DDD restructure); `docs/architecture.md`; `docs/superpowers/plans/2026-07-17-ddd-restructure.md`

## Context

The backend was restructured into a domain-driven layout (issue #59): packages
organized by domain concept — `domain/entry`, `domain/group`, `domain/ledger`,
with `application/addentry`, `interfaces/rest`, and `infrastructure/postgres`
around them.

That restructure is **structural** DDD: it draws package boundaries by domain
concept. It raised a follow-up question worth recording deliberately rather than
leaving to be re-litigated later:

> Is it legitimate to stop at structural DDD, or should we adopt the full set of
> **tactical** DDD building blocks — in particular, a rich `Entry` aggregate/entity
> that enforces its own invariants at construction, so an invalid `Entry` cannot
> exist in memory?

A related worry motivated the question: *"we should validate entities somewhere
other than only Postgres."*

### What the code actually does today

Validation is **not** concentrated in Postgres. It is spread across four layers,
and the domain layer already carries the load-bearing invariants:

- **`domain/ledger` (pure, no DB) — the real domain logic.**
  `ledger.ComputePostings` (`internal/domain/ledger/split.go:16`) and
  `ledger.SettlementPostings` (`split.go:160`) validate and compute in one step:
  amount bounds (`(0, ¥100B]`), non-empty participants, no duplicate
  participants, split-rule coverage (`coversExactly`, `split.go:59`), percentages
  summing to 100, exact amounts summing to `total`, per-weight bounds, and
  unknown split types. Every successful call returns postings that provably sum
  to zero — the core double-entry invariant, asserted directly in
  `property_test.go`.

- **`application/addentry` (pure) — orchestration-level rules.**
  Kind must be `expense`/`settlement`; settlement requires a counterparty
  (`internal/application/addentry/addentry.go:107`). Crucially,
  `computePostings` runs as the **first** action in `AddEntry` (`addentry.go:77`),
  *before* any DB round-trip — so an invalid request returns `422` without ever
  writing a pending idempotency row.

- **`interfaces/rest` — shape validation.** UUID parsing, idempotency-key
  presence, body-size limit, JSON validity, date format
  (`internal/interfaces/rest/entries.go:34`).

- **`infrastructure/postgres` — group membership + idempotency uniqueness**,
  enforced inside the write transaction.

The one invariant enforced **only** by Postgres is **group membership** (is every
`payer`/`counterparty`/`participant` actually a member of the group?).

## Decision

**We adopt structural DDD plus domain-service validation, and we do not introduce
rich entity/aggregate types at this time.** Concretely:

1. **Packages are organized by domain concept** (structural DDD). This stays.

2. **Invariants live in domain-service functions, not on entity methods.**
   `domain/ledger` is our tactical layer: `SplitRule`/`Posting`/`SplitType` are
   value objects (data shapes in `ledger.go`), and `ComputePostings` /
   `SettlementPostings` are domain services (behavior in `split.go`). This is
   deliberately where cross-field invariants are enforced.

3. **No rich `Entry` aggregate.** `entry.Input` and `addentry.Command` remain
   DTOs. We do **not** add an `entry.New(...) (*Entry, error)` constructor whose
   job is to protect invariants.

4. **Group membership is enforced transactionally in Postgres, by design** — not
   as a gap. `domain/group.MembershipChecker` exists as a port but is
   deliberately **unwired** on the write path; it is scaffolding for the read
   path / member-management use cases (Phase 3, issues #23–#27).

### Why no rich aggregate

A rich aggregate earns its keep when invariants span multiple fields **and** the
object mutates over its lifetime — the aggregate's job is to keep every mutation
legal. tally-up's `Entry` is **immutable and append-only**: created once, never
mutated (the whole ledger design). The only cross-field invariant that matters —
`Σ postings = 0` given payer/total/split/participants — is already enforced by
`ledger.ComputePostings` at the single moment of creation.

So an `entry.New()` aggregate would mostly be ceremony wrapping checks that
already exist, in a package (`domain/ledger`) that is well-factored precisely
because it computes postings *from* an entry's fields rather than owning the
entry. Adding the aggregate would buy little and add indirection.

### Why membership stays in Postgres (the deliberate exception)

Membership requires a database read. Checking it in-domain *before* the insert
would reintroduce a **TOCTOU race**: a member could be removed between the
pre-flight check and the insert. Folding the check into the same transaction as
the entry insert closes that window. This was an explicit design fork chosen
during issue #59 ("atomic-only, port unwired") over adding a pre-flight check.
The cost we accept: a bad member reference is reported after the DB round-trip
(as `422 group.ErrNotMember`, `entries.go:87`) rather than before it.

## Consequences

**Positive**
- The core financial invariant (`Σ postings = 0`) is enforced in pure, fast,
  DB-free domain code and is unit/property-testable in isolation.
- Invalid requests fail before creating any Postgres state (no orphan pending
  idempotency rows).
- No aggregate ceremony to maintain for an object that never mutates.
- Membership has no TOCTOU window on the write path.

**Negative / accepted trade-offs**
- Membership validity is *not* known in the domain layer on the write path; a
  reviewer must know it is enforced in `infrastructure/postgres`, not overlook it.
- `MembershipChecker` is intentionally dead code until Phase 3 — this must not be
  "cleaned up" as unused.
- If a future entry type becomes **mutable** (edits/reversals that change fields
  in place rather than appending a compensating entry), this decision should be
  revisited — mutation is exactly the condition under which a rich aggregate
  starts to earn its keep. Reversals as currently planned (append-only) do **not**
  trigger this.

## Alternatives considered

- **Position A — stay structural, treat validation as incidental.** Rejected as a
  *statement*: it undersells what `domain/ledger` already guarantees and would
  leave the membership decision undocumented.
- **Position B — full tactical: rich `Entry` aggregate.** Rejected: entries are
  immutable, so the aggregate guards almost nothing that `ledger` doesn't already
  guard; net cost is indirection.
- **Position C — hybrid, drawn deliberately.** Accepted (this ADR).
