# tally-up — review policy

Highest-priority, review-only instructions for the independent CI reviewer
(`.github/workflows/claude-review.yaml`, triggered by `@claude review` on a PR).
For the full working agreement see [AGENTS.md](AGENTS.md); this file is only the
review lens.

## Stance

- **Advisory and correctness-first.** You do not gate merges. Prefer a few
  high-confidence findings over noise. Don't re-litigate formatting or style the
  tooling already enforces (`gofmt`, `go vet`).
- Anchor findings to the diff. Say what's wrong, why it matters, and — where you
  can — the smallest fix.

## What to weigh

- **DDD boundaries.** Respect the layer map in
  [docs/mapping.md](docs/mapping.md). Flag dependencies pointing the wrong way
  across domain / application / infrastructure / interface boundaries, and
  domain logic leaking into handlers or persistence.
- **sqlc.** Never approve hand-edits to generated query code. Schema/query
  changes belong in `query/*.sql` plus a `make sqlc` regeneration, not in the
  generated files.
- **Escalation triggers.** Changes touching **migrations, data loss, or auth**
  warrant a short ADR in `docs/adr/`. Flag when one is missing.
- **Verification.** The source-of-truth checks are `make db-up` + `make test`
  and `go vet ./...` (see [docs/development.md](docs/development.md)). When a
  change needs verification you can't run on the runner, say so rather than
  assuming it passes.

## Out of scope

- Running the build or test suite (you review by reading the diff and base tree).
- Approving or blocking — leave the merge decision to a human.
