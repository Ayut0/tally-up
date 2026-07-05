# tab — Plan Tracking

**Session goal (2026-07-05): planning and refining.** All four phase plans are
written and self-reviewed. Implementation has NOT started (a false start on
Plan 1 Task 1 was discarded; `main` contains docs only).

## Plans (execution order)

1. `docs/superpowers/plans/2026-07-05-ledger-core-write-path.md` — Phases 1–2
2. `docs/superpowers/plans/2026-07-05-reads-and-reversals.md` — Phases 3–4
3. `docs/superpowers/plans/2026-07-05-nextjs-client.md` — Phase 5
4. `docs/superpowers/plans/2026-07-05-settle-up.md` — Phase 6

Not yet planned: v1.1 (outbox → Pushover/Discord notifications, SSE), chaos
pass extension for concurrent checked settlements, real auth.

## Implementation checklist (all pending)

- [ ] Plan 1: ledger core + idempotent write path (9 tasks)
- [ ] Plan 2: reads + reversals (5 tasks)
- [ ] Plan 3: Next.js client (5 tasks)
- [ ] Plan 4: settle-up (4 tasks)

## Review

### 2026-07-05 — planning session
- Architecture draft added (`docs/architecture.md`), then refined twice from
  discoveries made while planning:
  - invariant 7 now includes the payer (and counterparty) in the posting set;
  - §4 gained release-on-failure and replay-bytes-from-DB rules.
- Plan 1 self-review caught: JSONB normalization vs byte-identical replay,
  pgx v5 multi-statement Exec rejection, retry-blocking stale pending keys,
  one placeholder block.
- Plan 2 (reads/reversals): `FOR UPDATE` serializes double-reversal races
  (row locks don't fire the append-only trigger); `as_of_seq` designed in as
  the future settle-up snapshot token; edit refactor extracts
  `reverseWithinTx`/`insertEntryWithinTx` to keep one copy of the SQL.
- Plan 3 (client): capability-URL + localStorage identity documented as the
  v1 auth trade-off; client mirrors the Go rounding engine with transcribed
  Go test cases as the parity contract; self-review fixed a rules-of-hooks
  violation and a placeholder import.
- Plan 4 (settle-up): greedy plan as pure `ledger` function under property
  tests (invariant 9); `plan_seq` staleness check made sound with a
  per-group `FOR UPDATE`, scoped so expense adds stay lock-free; stale 409
  carries the fresh `as_of_seq` so the client re-proposes in one round trip.
- Process lesson captured in `tasks/lessons.md` (goal scope governs phase
  transitions).
