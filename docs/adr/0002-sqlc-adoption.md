# 2. Adopt sqlc for the Postgres data-access layer, with a google/uuid override

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** Yuto
- **Related:** Issues #62 (foundation + idempotency), #63 (idempotency gate),
  #64 (entries write path), #66 (reads, reversals, integrity), #65 (this
  decision, retiring the last inline SQL and `Store`'s query-method surface);
  `docs/mapping.md`; `docs/development.md` (sqlc workflow, verify commands)

## Context

`internal/infrastructure/postgres` originally hand-rolled every query as
inline `pgx` calls on a single `Store` type, which also implemented every
domain repository interface directly. That coupled all Postgres access to one
large type, gave no compile-time check that a query's Go-side scan matched
its SQL column list, and made `Store` both a connection/migration owner and a
query layer at once.

Issues #62 through #66 migrated the write path, idempotency gate, membership
check, reads (`GetBalances`/`ListEntries`), the correction paths
(`Reverse`/`Edit`), and the integrity check onto generated queries, one
concern at a time, without changing behavior (error mappings, row locks, the
single-MVCC-snapshot property of `GetBalances`, etc.). This issue is the
close-out slice: no hand-written inline SQL remains in any production code
path, and `Store` itself needed to stop being a repository.

## Decision

### sqlc generates the query layer

- Hand-written SQL lives in `internal/infrastructure/postgres/query/*.sql`,
  one file per aggregate/concern (`entries.sql`, `idempotency.sql`,
  `membership.sql`).
- `sqlc generate` (config: `sqlc.yaml`) produces the typed `Queries`,
  `Querier`, and row/param structs in `internal/infrastructure/postgres/sqlc`.
  `make sqlc` runs it; CI/verify expects it to produce **no diff** against
  the committed generated code.
- `sql_package: "pgx/v5"` — generated code executes against anything
  satisfying `sqlc.DBTX`, which both `*pgxpool.Pool` and `pgx.Tx` satisfy.

### The repository + context-transaction pattern is the standard

Every repository (`IdempotencyRepository`, `EntryRepository`,
`ReadRepository`, `IntegrityRepository`, `MembershipRepository`) follows the
same shape, and any future DB work should too:

- Embed `BaseRepository` (`base.go`), which resolves a `*sqlc.Queries` bound
  to the active session for a given `ctx` — the connection pool by default,
  or an in-flight `pgx.Tx` when one is bound to the context.
- Multi-statement writes run through `Transaction.Do` (`transaction.go`),
  which begins a transaction, binds it to `ctx` via `withSession`, and
  commits/rolls back based on the wrapped function's error — so a repository
  method behaves identically whether or not it's inside a transaction, and
  callers never thread a `*pgx.Tx` through method signatures.
- Each repository satisfies one narrow domain port (`entry.Repository`,
  `entry.Reverser`, `entry.BalanceReader`, `group.MembershipChecker`, ...)
  rather than one god-interface, so application services depend on exactly
  the capability they need.

### `uuid` columns map to `github.com/google/uuid.UUID`, not `pgtype.UUID`

`sqlc.yaml`'s `overrides` remap every Postgres `uuid` column (and its
nullable variant, as a pointer) to `google/uuid.UUID` instead of sqlc's
default `pgtype.UUID`. `domain` and `application` already use
`google/uuid.UUID` throughout (`entry.Input.ID`, `group` IDs, etc.); the
override means generated repository code speaks that same type directly, with
no adapter/conversion step at the repository boundary, and no Postgres-
specific type ever crosses into a port signature.

### `Store`'s final shape: pool + migrations only

`Store` (`store.go`) now holds only `Pool *pgxpool.Pool` plus named
(non-embedded) handles to each repository — `Idempotency`, `Entries`,
`Reads`, `Integrity`. Its only behavior is `New` (connect + migrate),
`Migrate`, and the `TestStore` test helper. Because the repository fields are
no longer *embedded*, Go does not promote their methods onto `Store`, so
`Store` itself satisfies no domain repository interface — wiring code
(`cmd/api/main.go`) and tests reach the actual capability by name
(`s.Entries.Create`, `s.Reads.GetBalances`, ...).

## Consequences

**Positive**
- Every query's Go-side types are checked against the schema at `sqlc
  generate` time, not discovered at runtime via a scan-mismatch panic.
- One consistent pattern (`BaseRepository` + `Transaction.Do`) for all
  present and future Postgres access — no mix of hand-written and generated
  query paths to reason about.
- `Store` is a single-responsibility type again: connect, migrate, hand out
  repositories. It can't accidentally grow query methods, because embedding
  is what would make that possible, and the pattern here is explicitly named
  fields instead.

**Negative / accepted trade-offs**
- Schema or query changes require an edit to `query/*.sql` plus `make sqlc`
  before the Go code compiles against the new shape — one more step than
  editing a `pgx` call inline, traded for the compile-time safety above.
- One more layer between a handler and the database (repository → sqlc
  `Queries` → `pgx`) than calling `pgx` directly; justified by the interface
  segregation described above.

## Alternatives considered

- **Keep hand-written `pgx` on `Store`.** Rejected — this was the status quo
  #62 through #66 replaced; no per-query type safety, and `Store` grew into a
  god-object implementing every domain port at once.
- **Use sqlc's default `pgtype.UUID`.** Rejected — would leak a
  Postgres-specific type into domain/application code (or force a
  conversion layer at every repository method boundary) for no benefit, since
  `google/uuid.UUID` already had first-class support via sqlc's type
  overrides and matched what the rest of the codebase already used.
