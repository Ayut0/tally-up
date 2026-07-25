# Development

Setup and the commands used to verify a change. `AGENTS.md` refers here for the
runnable detail so the working agreement stays a thin index.

## Prerequisites

- Go 1.25
- Docker (for the local Postgres container the tests run against)
- `sqlc` — `brew install sqlc` — to regenerate the typed query layer

## Verify commands

Tests need a running Postgres container: `go test ./...` alone will fail
without `make db-up` first.

```bash
make db-up          # start local Postgres (docker compose), required for tests
make test           # TEST_DATABASE_URL=... go test -p 1 ./... -race
                    # (adds CGO_ENABLED=0 on macOS only — see the Makefile)
go vet ./...        # static checks (no golangci config in this repo)
make sqlc           # regenerate typed queries after editing query/*.sql
```

See the `Makefile` target comments for the other targets (`run`, `seed`,
`smoke`, `db-down`).

## CI

[`.github/workflows/ci.yaml`](../.github/workflows/ci.yaml) runs `go build`,
`go vet`, and the same `make test` on every pull request and every push to
`main`. It is blocking; the `@claude review` reviewer is advisory and
comment-triggered.

**CI does not run DB-backed tests yet.** It invokes `make test DATABASE_URL=`,
so with no `TEST_DATABASE_URL` the tests that need Postgres skip and what runs
is the domain and pure-logic coverage. Running the full suite is still on you
locally: `make db-up && make test`.

When the database is turned on in CI, the workflow gains a `services: postgres`
block and sets `TALLYUP_REQUIRE_DB=1`. That variable flips a missing
`TEST_DATABASE_URL` from a skip into a hard failure, so an environment that
believes it is exercising the database but silently isn't fails loudly instead
of reporting green. Set it locally too if you want the same strictness:

```bash
TALLYUP_REQUIRE_DB=1 make test    # fails rather than skips if the DB is missing
```

See `decideDBURL` in `internal/infrastructure/postgres/store.go`.

## sqlc workflow

The typed query layer is generated from hand-written SQL:

- Config: `sqlc.yaml` (the source of truth for paths).
- Queries: `internal/infrastructure/postgres/query/*.sql`, one file per
  aggregate.
- Migrations: `internal/infrastructure/postgres/migrations/`.

Edit a `query/*.sql` file, then run `make sqlc` to regenerate.
