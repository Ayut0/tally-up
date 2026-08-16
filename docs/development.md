# Development

Setup and the commands used to verify a change. `AGENTS.md` refers here for the
runnable detail so the working agreement stays a thin index.

## Prerequisites

- Go 1.25
- Docker (for the local Postgres container the tests run against)
- `sqlc` — `brew install sqlc` — to regenerate the typed query layer. CI pins
  `v1.30.0`; match it locally to avoid spurious diffs (see the CI section).

## Verify commands

Tests need a running Postgres container: `go test ./...` alone will fail
without `make db-up` first.

```bash
make db-up          # start local Postgres (docker compose), required for tests
make test           # TEST_DATABASE_URL=... go test -p 1 ./... -race
                    # (adds CGO_ENABLED=0 on macOS only — see the Makefile)
go vet ./...        # static checks
make lint           # golangci-lint, config in .golangci.yaml — see the CI section below
make sqlc           # regenerate typed queries after editing query/*.sql
make sqlc-check     # fail if generated output is stale — what CI runs
```

See the `Makefile` target comments for the other targets (`run`, `seed`,
`smoke`, `db-down`).

## CI

[`.github/workflows/ci.yaml`](../.github/workflows/ci.yaml) runs two jobs on
every pull request and every push to `main`: `test` (`make sqlc-check`, `go
build`, `go vet`, `golangci-lint`, `make test-nodb`) and `web` (`npm ci`,
`npm run lint`, `npm run format:check`, `npm run build`, `npm test` in
`web/`). Both are blocking;
the `@claude review` reviewer is advisory and comment-triggered. Neither job
is yet a required status check on `main` — that's a deliberate open decision
left to the maintainer (see the `test`/`web` job comments in ci.yaml).

Third-party actions in these workflows are pinned to commit SHAs rather than
mutable tags (a tag can be repointed by whoever controls the action repo).
[`.github/dependabot.yml`](../.github/dependabot.yml) watches for new tags on
pinned actions and opens a PR to bump them — pins are updated by Dependabot,
not by hand.

**Linter set:** `.golangci.yaml` enables `standard` (errcheck, govet,
ineffassign, staticcheck, unused) plus `bodyclose`, `errchkjson`, `exhaustive`,
`gocritic`, `gosec`, `modernize`, and `noctx`, with test files exempted from
the four that mainly guard production code (`gosec`, `noctx`, `bodyclose`,
`errchkjson`). This was decided in #98 by measuring `--default=all` against
the repo (177 findings) and scoping down to what's worth enforcing (42); see
that issue for the reasoning behind each inclusion/exclusion and the two
decisions still deliberately left open (`revive`'s exported-comment rule,
`wrapcheck` adoption). The golangci-lint version itself is pinned — in the
Makefile's `GOLANGCI_LINT_VERSION` and the CI step's `version:` input,
kept in sync — so a new release can't turn CI red on an unrelated PR.

**sqlc version:** the `sqlc up to date` step (#97) regenerates
`internal/infrastructure/postgres/sqlc/` via `make sqlc-check` and fails if
that produces a diff against what's committed — catching a `query/*.sql` edit
that was never run through `make sqlc`. The `sqlc-version` pinned in
`ci.yaml`'s `setup-sqlc` step must match whatever version generated the
committed code (currently `v1.30.0`); bump both together when upgrading
sqlc, or the version drift itself will turn this red.

**CI does not run DB-backed tests yet.** It invokes `make test-nodb`, which
blanks `TEST_DATABASE_URL` so the tests that need Postgres skip; what runs is
the domain and pure-logic coverage. Running the full suite is still on you
locally: `make db-up && make test`.

When the database is turned on in CI, the workflow gains a `services: postgres`
block and sets `TALLYUP_REQUIRE_DB=1`. That variable flips a missing
`TEST_DATABASE_URL` from a skip into a hard failure, so an environment that
believes it is exercising the database but silently isn't fails loudly instead
of reporting green. Set it locally too if you want the same strictness:

```bash
TALLYUP_REQUIRE_DB=1 make test    # fails rather than skips if the DB is missing
```

See `decideDBURL` in
`internal/infrastructure/postgres/postgrestest/postgrestest.go`.

## sqlc workflow

The typed query layer is generated from hand-written SQL:

- Config: `sqlc.yaml` (the source of truth for paths).
- Queries: `internal/infrastructure/postgres/query/*.sql`, one file per
  aggregate.
- Migrations: `internal/infrastructure/postgres/migrations/`.

Edit a `query/*.sql` file, then run `make sqlc` to regenerate. CI enforces
this: `make sqlc-check` fails the build if a `query/*.sql` change wasn't
regenerated before pushing.
