# tally-up — Working Agreement

tally-up is a DDD Go backend for **tab**, an n-person bill splitter. This file is
the working agreement for any agent or contributor. It is intentionally thin: it
routes to the [superpowers](https://github.com/obra/superpowers) skills for
*how* to work, and only spells out the facts that are specific to this repo.

If you have the superpowers plugin, invoke the named skill. If you don't, the
one-line description tells you what that phase expects.

## The cycle

Every unit of work follows `plan → implement → self-review → verify → report`:

1. **Plan** — clarify intent and design before coding. → `brainstorming`, then
   `writing-plans` for anything multi-step.
2. **Implement** — write the change test-first where there's runtime behavior. →
   `test-driven-development`.
3. **Self-review** — reset into reviewer mode and read your own diff before
   asking anyone else. → `requesting-code-review`.
4. **Verify** — run the verify commands and report the actual output, not a
   claim. → `verification-before-completion`.
5. **Report** — summarize outcome, verification evidence, trade-offs, and any
   open follow-ups.

## Skill routing

| When you're… | Use |
| --- | --- |
| Building a feature or changing behavior | `brainstorming` → `writing-plans` |
| Executing an approved plan | `executing-plans` / `subagent-driven-development` |
| Chasing a bug, test failure, or surprise | `systematic-debugging` |
| Writing code or a bugfix | `test-driven-development` |
| Finishing, before merge | `requesting-code-review`, `verification-before-completion` |
| Suspending work across sessions | `handoff` |

## Project map

Module `tallyup` (Go 1.25), entry point `cmd/api`, Postgres for persistence.
The code map — DDD layers and what each is responsible for — lives in
[docs/mapping.md](docs/mapping.md); design rationale in
[docs/architecture.md](docs/architecture.md).

## Verify

Run the verify commands and report their actual output before you call a change
done. Setup and the exact commands live in
[docs/development.md](docs/development.md) — in short, `make db-up` then
`make test`, plus `go vet ./...`.

## Conventions

- **Branches:** `<prefix>/issue-<number>-<short-description>` (`feat/`, `bugfix/`,
  `doc/`). One issue per branch — never mix issues.
- **Worktrees:** work each issue in its own git worktree.
- **Syncing:** `git rebase origin/main`. Never `git merge main` or a plain
  `git pull` on a feature branch.
- **Commits/PRs:** open a PR per issue; link it to the issue it addresses.

## Escalation

Changes touching **migrations, data loss, or auth** warrant extra review and a
short ADR in `docs/adr/` recording the decision. Design specs live in
`docs/superpowers/specs/`.
