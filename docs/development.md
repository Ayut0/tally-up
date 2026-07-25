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
`main`, against a Postgres the runner starts and discards. It is blocking; the
`@claude review` reviewer is advisory and comment-triggered.

One difference from local runs: **skipping is fatal under CI**. Without
`TEST_DATABASE_URL`, DB-backed tests skip locally so `go test ./...` stays
usable without Docker, but the same condition fails the build in CI — otherwise
a workflow that lost its database would skip the entire suite and still report
green. See `decideDBURL` in
`internal/infrastructure/postgres/store.go`.

To reproduce a CI failure locally, `make db-up` then `make test`: the container
image and credentials are the same, only the port differs (5433 locally, 5432
on the runner).

## sqlc workflow

The typed query layer is generated from hand-written SQL:

- Config: `sqlc.yaml` (the source of truth for paths).
- Queries: `internal/infrastructure/postgres/query/*.sql`, one file per
  aggregate.
- Migrations: `internal/infrastructure/postgres/migrations/`.

Edit a `query/*.sql` file, then run `make sqlc` to regenerate.
