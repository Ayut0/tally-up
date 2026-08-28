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
make e2e            # Gherkin E2E suite through a real browser (see below)
```

## Test tiers

Three suites, each seeing a failure class the others can't. Pick the lowest
tier that can hold the case.

| Tier | Command | Renders? | Network |
| --- | --- | --- | --- |
| Go suite | `make test` | n/a | real Postgres |
| `web/` logic | `make web-test` | never (#138) | n/a — pure rules and hooks |
| Storybook interaction | `cd web && npm run test:storybook` | yes, one component | MSW-mocked (ADR 0005) |
| E2E (Gherkin) | `make e2e` | yes, whole app | real Go API + Postgres (ADR 0006) |

`make e2e` starts Postgres, then Playwright boots the API and the web client
itself. It's the slowest tier by design — reach for it when a case genuinely
spans client and server, not as a substitute for a unit test. Structure and
conventions: [`web/e2e/README.md`](../web/e2e/README.md).

**Don't run `make test` and `make e2e` concurrently against the same local
database** — the Go test helper truncates shared tables and will delete rows
a running scenario is using. CI gives them separate service containers.

See the `Makefile` target comments for the other targets (`run`, `seed`,
`smoke`, `db-down`).

## CI

[`.github/workflows/ci.yaml`](../.github/workflows/ci.yaml) runs two jobs on
every pull request and every push to `main`: `test` (`make sqlc-check`, `go
build`, `go vet`, `golangci-lint`, `make test` against a `postgres` service
container) and `web` (`npm ci`, `npm run lint`, `npm run format:check`, `npm
run build`, `npm test` in `web/`). Both are blocking;
the `@claude review` reviewer is advisory and comment-triggered. Neither job
is yet a required status check on `main` — that's a deliberate open decision
left to the maintainer (see the `test`/`web` job comments in ci.yaml).

A third job, `e2e`, runs the Gherkin suite against a real stack (Go API +
Postgres service container + a production Next.js build). It is
`continue-on-error: true` for now — the same advisory footing `storybook
build` and the Storybook interaction tests entered on — so a flaky
first-generation E2E suite can't block a merge. See
[ADR 0006](adr/0006-gherkin-e2e-tier.md).

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

**CI runs the full suite, including DB-backed tests.** The `test` job's
`services` block starts a `postgres:16-alpine` container (mirroring
`docker-compose.yml`, on port 5432 instead of the local 5433), and the `Test`
step runs plain `make test` against it with `TALLYUP_REQUIRE_DB=1` set. That
variable flips a missing `TEST_DATABASE_URL` from a skip into a hard failure,
so an environment that believes it is exercising the database but silently
isn't fails loudly instead of reporting green. Set it locally too if you want
the same strictness:

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
