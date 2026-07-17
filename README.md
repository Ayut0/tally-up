# tally-up

A bill splitter for friend groups — trips, dinners, gatherings, n people, not just two.

Built around one idea: **the ledger is the truth.** Every balance is derived by replaying an append-only log of expenses and settlements, never stored as mutable state. Strong consistency and idempotency are first-class design goals, not afterthoughts — balances must be provably correct across many phones, over flaky mobile networks, with retries.

## Status

Phase 1-2 implemented: the pure ledger package, Postgres store, idempotency gate, and HTTP write path (`POST /groups/{group_id}/entries`) are in place, with chaos/concurrency tests covering the idempotency and zero-sum invariants. See [`docs/architecture.md`](docs/architecture.md) for the full design and [`docs/superpowers/plans/`](docs/superpowers/plans/) for the implementation plans (executed in order):

1. `2026-07-05-ledger-core-write-path.md` — split engine + idempotent write path
2. `2026-07-05-reads-and-reversals.md` — balances, history, delete/edit as reversing entries
3. `2026-07-05-nextjs-client.md` — the web app
4. `2026-07-05-settle-up.md` — minimal-transfer settle-up plan

## Design highlights

- **Append-only double-entry ledger.** Expenses and settlements expand into per-member postings that always sum to zero. Corrections are new reversing entries, never edits to history.
- **Uneven splits.** Equal, exact amounts, shares, and percentages, with deterministic largest-remainder rounding — same input always produces byte-identical postings.
- **Partial participation.** Not everyone joins every expense; each entry names its own participants.
- **Idempotent writes.** A pending-row-first gate means double-taps and client retries never double-count an expense.
- **Settle-up plans.** A minimal set of proposed transfers computed from net balances, checked against a snapshot so a stale plan can't be applied by accident.
- **Integer yen only.** No floating-point money, anywhere.

## Stack

- **Client:** Next.js (App Router), mobile-first, no install required — open an invite link on any phone.
- **API:** Go, `pgx`, single Postgres primary (Neon).
- **DB:** Postgres, with the schema itself acting as documentation of the design.

See [`docs/architecture.md`](docs/architecture.md) for the full rationale behind these choices, including what's deliberately out of scope for v1 (offline-first multi-device sync, multi-currency, payment execution).

## Development

### Running tests

Tests in `internal/store` and `internal/api` need a real Postgres to exercise the JSONB storage, idempotency gate, and constraint behavior — they skip cleanly if no database is configured, but you won't get real coverage without one.

```sh
docker compose up -d db
export TEST_DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable'
```

**Always run the full suite with `-p 1` once `TEST_DATABASE_URL` is set:**

```sh
go test -p 1 ./... -race
```

`internal/api` and `internal/store` both truncate the same live Postgres tables via a shared test helper. Go parallelizes different packages' test binaries by default, so without `-p 1` the two packages' truncations race against each other's in-flight tests and deadlock. Plain `go test ./...` (no flags) is unsafe whenever `TEST_DATABASE_URL` is exported.

On some macOS setups you'll also need `CGO_ENABLED=0` for `go build`/`go test`/`go vet` to work around an unrelated toolchain dyld quirk on this platform.

### Migrations

`migrations/*.sql` is the source of truth. It's manually copied into `internal/store/migrations/*.sql` because Go's `go:embed` can't reach outside its own package tree — the store package embeds its local copy at build time. If you add or change a migration, copy it to both locations; there's no automated drift check yet.
