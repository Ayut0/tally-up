# tally-up — Working Agreement

tally-up is a DDD Go backend for **tab**, an n-person bill splitter. This file is
the working agreement for any agent or contributor. It is intentionally thin: it
routes to the [matt-pocock skill suite](https://github.com/mattpocock/skills) for
*how* to work, and only spells out the facts that are specific to this repo.

If you have those skills installed, invoke the named skill. If you don't, the
one-line description tells you what that phase expects. A few phases have no skill
of their own — they're spelled out inline.

## The cycle

Every unit of work follows `plan → implement → self-review → verify → report`:

1. **Plan** — clarify intent and design before coding. Scope the work with
   `to-prd` / `to-issues`, then pressure-test the plan against the domain model
   with `grill-with-docs`.
2. **Implement** — write the change test-first where there's runtime behavior. →
   `tdd`.
3. **Self-review** — *(no skill)* reset into reviewer mode and read your own diff
   before asking anyone else.
4. **Verify** — *(no skill)* run the verify commands and report the actual
   output, not a claim — see [Verify](#verify).
5. **Report** — summarize outcome, verification evidence, trade-offs, and any
   open follow-ups.

## Skill routing

| When you're… | Use |
| --- | --- |
| Turning an idea into scoped work | `to-prd` → `to-issues` |
| Pressure-testing a plan against the domain | `grill-with-docs` |
| Triaging an incoming issue | `triage` |
| Writing code or a bugfix | `tdd` |
| Chasing a bug, test failure, or surprise | `diagnose` |
| Refactoring or improving structure | `improve-codebase-architecture` |
| Zooming out to the whole system | `zoom-out` |
| Suspending work across sessions | `handoff` |
| Self-reviewing or verifying | *(no skill — see [The cycle](#the-cycle))* |

## Agent skills

Configuration the matt-pocock skills read to learn this repo's issue tracker
and domain-doc layout.

### Issue tracker

Issues live as GitHub issues on `Ayut0/tally-up` (via the `gh` CLI). See
[docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Domain docs

Single-context repo. See [docs/agents/domain.md](docs/agents/domain.md).

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
