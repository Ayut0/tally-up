# tally-up — Plan Tracking

Six implementation plans written and self-reviewed. Implementation has NOT
started (a false start on Plan 1 Task 1 was discarded; `main` contains docs
only, plus GitHub issue #1 for expense categories/tags, not yet designed).

## Plans (suggested execution order)

1. `docs/superpowers/plans/2026-07-05-ledger-core-write-path.md` — Phases 1–2
2. `docs/superpowers/plans/2026-07-05-reads-and-reversals.md` — Phases 3–4
3. `docs/superpowers/plans/2026-07-05-nextjs-client.md` — Phase 5
4. `docs/superpowers/plans/2026-07-05-settle-up.md` — Phase 6
5. `docs/superpowers/plans/2026-07-06-pairwise-and-member-management.md` — pairwise "who owes whom" + add/remove members
6. `docs/superpowers/plans/2026-07-06-group-password.md` — optional server-enforced group password

Plans 5–6 come from `docs/superpowers/specs/2026-07-06-group-membership-privacy-pairwise-design.md`
and depend on all of Plans 1–4 being implemented first (they extend
`store.Store`, `api.Server`, and `web/lib/api.ts`). Plan 6 also depends on
Plan 5 (its middleware wraps the routes Plan 5 adds).

Not yet planned: v1.1 (outbox → Pushover/Discord notifications, SSE), chaos
pass extension for concurrent checked settlements, expense categories/tags
(GitHub issue #1).

## Implementation checklist (all pending)

- [ ] Plan 1: ledger core + idempotent write path (9 tasks)
- [ ] Plan 2: reads + reversals (5 tasks)
- [ ] Plan 3: Next.js client (5 tasks)
- [ ] Plan 4: settle-up (4 tasks)
- [ ] Plan 5: pairwise balances + member management (5 tasks)
- [ ] Plan 6: group password protection (6 tasks)

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
- Renamed the whole project from a leftover working title ("tab") to
  tally-up across every doc — caught by the user, not self-review.

### 2026-07-06 — use cases, design, and two more plans
- Use-case review (`docs/use-cases.md`) surfaced four candidates; user
  confirmed two as real requirements: true pairwise "who owes whom" (not
  just the minimal-transfer settle-up plan) and a server-enforced optional
  group password. Refunds explicitly dropped (users can just adjust later).
  Filed GitHub issue #1 for expense categories/tags (undesigned, v1.1+).
- Brainstormed both features into
  `docs/superpowers/specs/2026-07-06-group-membership-privacy-pairwise-design.md`,
  user-approved. Key finding: pairwise balances need **no schema change** —
  every expense already has one payer + a participant list, so true
  per-pair debt is fully derivable from existing `entries`/`postings`.
  Password protection is one shared secret per group (never per-user
  accounts) — explicit non-goal confirmed with the user.
- Split into two plans per the spec's own suggestion (Plan 5 small/no new
  infra, Plan 6 bigger/first real access-control layer). Cross-plan
  self-review caught a real regression risk: Plan 6's rewritten
  `postIdempotent` in `web/lib/api.ts` would have silently dropped the
  `PlanStaleError` check the settle-up plan (Plan 4) already added to that
  same function — fixed by preserving it explicitly in the plan text.

### 2026-07-07 — switched every minted ID to UUIDv7
- User asked v4 or v7; decided v7 (time-ordered) for all IDs. Swept every
  plan: schema `DEFAULT gen_random_uuid()` removed from `members`/`groups`
  (every insert now supplies an explicit ID — no silent-fallback-to-v4 path),
  Go's two server-side member-minting spots (`CreateGroup`, `AddMember`) now
  call `uuid.NewV7()` explicitly, and every client-side mint switched from
  `crypto.randomUUID()` (v4-only, no browser v7 API exists) to a new
  hand-rolled `web/lib/uuidv7.ts` helper (added to the Next.js client plan's
  Task 2, RFC 9562 layout, no new dependency). Test-fixture `uuid.New()`
  calls in Go test code were deliberately left as v4 — arbitrary IDs in
  tests don't care about version. Caught and fixed one flaky test written
  during this sweep: "consecutive IDs sort ascending" doesn't hold for v7
  within the same millisecond (random bits, not a counter) — rewrote it to
  control time explicitly via `vi.setSystemTime`.
