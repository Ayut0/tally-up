# Code map

Where things live and what each layer is responsible for. `AGENTS.md` refers
here so the working agreement stays a thin index. For *why* the system is shaped
this way see [architecture.md](architecture.md); for build and verify commands
see [development.md](development.md).

- **Module:** `tallyup` (Go 1.25)
- **Entry point:** `cmd/api`

## DDD layers (`internal/`)

- `domain/` — aggregates and invariants (`ledger`, `group`, `entry`).
- `application/` — use cases (`addentry`, `correctentry`).
- `infrastructure/` — adapters, incl. `infrastructure/postgres` (the
  sqlc-generated query layer; see [development.md](development.md) for the sqlc
  workflow and paths).
- `interfaces/` — delivery, incl. `interfaces/rest`.
