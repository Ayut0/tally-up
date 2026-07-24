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
make test           # TEST_DATABASE_URL=... CGO_ENABLED=0 go test -p 1 ./... -race
go vet ./...        # static checks (no golangci config in this repo)
make sqlc           # regenerate typed queries after editing query/*.sql
```

See the `Makefile` target comments for the other targets (`run`, `seed`,
`smoke`, `db-down`).

## sqlc workflow

The typed query layer is generated from hand-written SQL:

- Config: `sqlc.yaml` (the source of truth for paths).
- Queries: `internal/infrastructure/postgres/query/*.sql`, one file per
  aggregate.
- Migrations: `internal/infrastructure/postgres/migrations/`.

Edit a `query/*.sql` file, then run `make sqlc` to regenerate.
