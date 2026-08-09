# 4. Retire the unused `plan_seq` column via a new migration, not an in-place edit

- **Status:** Accepted
- **Date:** 2026-08-09
- **Deciders:** Yuto
- **Related:** Issue #155 (this decision); PR #128 / Issue #122 (the design
  that used the column, closed unmerged); `docs/adr/0002-sqlc-adoption.md`
  (schema-as-source-of-truth for sqlc)

## Context

`entries.plan_seq BIGINT` (`internal/infrastructure/postgres/migrations/0001_init.up.sql`,
duplicated at the repo-root `migrations/0001_init.up.sql`) was added for an
optimistic-concurrency check on settlement writes. That check was built out
in PR #128 (`checkPlanFresh` / `LockGroupForSettlement`, a `plan_seq` field on
the create-entry request, a `PlanStale` 409 response) — reviewed clean twice
by the independent reviewer — and then closed **unmerged**:

- First rejected because it leaked a concurrency-control mechanism into a
  client-facing contract (the client should not have to know about optimistic
  locking to record a payment).
- Its successor design (a server-enforced "cannot overpay" invariant) was
  also rejected, on product grounds: overpayment is allowed — it happens
  through typos and miscommunication between real people, so the ledger must
  represent what actually occurred rather than refuse it. The remedy already
  ships as `internal/application/correctentry` (`Reverse`/`Edit`).

So `plan_seq` reached the schema and sqlc's generated `Entry` model, but no
application code ever read or wrote it. It is evidence of a design that was
designed, reviewed, and reverted — sitting in the schema for the next person
to trip over.

## Decision

Drop `plan_seq` with a new migration, `0002_drop_plan_seq`
(`ALTER TABLE entries DROP COLUMN plan_seq`), added to both migration
directories in lockstep — not by editing `0001_init` in place.

Regenerate `internal/infrastructure/postgres/sqlc/models.go` (`make sqlc`)
so `Entry.PlanSeq` disappears from the generated model, and correct the
`spec/main.tsp` doc comment on `SettlePlan.as_of_seq` that claimed a
recorded settlement "passes back" `as_of_seq` as `plan_seq` — that hand-off
never existed in shipped code, so the comment was documenting the reverted
design rather than the actual contract.

## Consequences

**Positive**
- The schema, the generated Go model, and the API spec's prose all agree
  with what the running system actually does: nothing about settlement
  concurrency crosses the wire.
- A future contributor grepping for `plan_seq` finds only this ADR and the
  migration that removed it, not a live column implying an unfinished or
  hidden mechanism.

**Negative / accepted trade-offs**
- One more migration file for a column that never held a row in any real
  environment — a small amount of history-file noise, accepted over the risk
  below.

## Alternatives considered

- **Edit `0001_init.up.sql` in place**, removing the `plan_seq` line
  directly instead of adding a new migration. Rejected: this repo's local
  Postgres container is long-lived (not recreated per test run), so it may
  already have `0001_init` applied. `golang-migrate` tracks only the highest
  applied version, not migration content — it does not re-run a version
  already recorded as applied. An in-place edit would therefore leave
  already-migrated environments with the column still present while fresh
  environments would never have it, a silent schema drift with no migration
  to reconcile it. A new migration reaches every environment identically,
  regardless of how far its migration history has already progressed.
