# tab — Current Plan Tracking

**Active plan:** `docs/superpowers/plans/2026-07-05-ledger-core-write-path.md`
(architecture Phases 1–2: ledger core + idempotent write path)

## Tasks

- [ ] Task 1: Ledger package — types + equal split, largest-remainder rounding
- [ ] Task 2: Shares and percent splits
- [ ] Task 3: Exact split + settlement postings
- [ ] Task 4: Property tests (zero-sum, determinism, coverage)
- [ ] Task 5: Schema migrations + test database plumbing
- [ ] Task 6: Idempotency gate + release + janitor sweep
- [ ] Task 7: Write path — CreateEntry + HTTP handler
- [ ] Task 8: main.go — wiring, janitor goroutine, graceful shutdown
- [ ] Task 9: Chaos test — 50× concurrent identical requests

## Follow-up plans (not yet written)

- [ ] Reads: balance endpoint, `after_seq` history, explain-this-balance (Phase 3)
- [ ] Reversals: delete/edit with double-reversal row lock (Phase 4)
- [ ] Next.js client: invite-link join, add-expense, balances, polling (Phase 5)
- [ ] Settle-up: greedy transfer plan + snapshot-seq check (Phase 6)
- [ ] v1.1: outbox + notifications, SSE

## Review

### 2026-07-05 — planning session
- Architecture draft added at `docs/architecture.md`.
- Implementation plan for Phases 1–2 written and self-reviewed. Four issues
  caught and fixed during review: a placeholder block, JSONB normalization
  breaking byte-identical replays (fixed with `UPDATE … RETURNING`), pgx v5
  rejecting multi-statement Execs in seed helpers, and pending idempotency
  rows blocking retries after post-gate validation failures (added
  `ReleaseIdempotencyKey`).
- Architecture doc refined to match: invariant 7 now includes the payer;
  §4 records the release-on-failure and replay-bytes-from-DB rules.
