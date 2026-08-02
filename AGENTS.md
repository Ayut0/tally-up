# tally-up — Working Agreement

tally-up is a DDD Go backend for **tab**, an n-person bill splitter. This file is
the working agreement for any agent or contributor. It is intentionally thin: it
routes to the [matt-pocock skill suite](https://github.com/mattpocock/skills) for
*how* to work, and only spells out the facts that are specific to this repo.

If you have those skills installed, invoke the named skill. If you don't, the
one-line description tells you what that phase expects. Two skills — `/address`
and `code-review-guideline` — live in this repo rather than the suite; the
reviewer skill in particular has to, because the CI reviewer reads it off a
checkout. **Verify** and **Report** have no skill at all; they're spelled out
inline.

## Requirement Level Keywords

This file and the docs it links use these words with a specific meaning:

| Keyword | Synonym | Meaning |
| ------- | ------- | ------- |
| "MUST" | "REQUIRED" | Non-negotiable requirement; no exceptions. |
| "MUST NOT" |  | Non-negotiable prohibition; no exceptions. |
| "SHOULD" | "RECOMMENDED" | Strongly preferred; deviation is allowed only after weighing the implications. |
| "SHOULD NOT" | "NOT RECOMMENDED" | Strongly discouraged; allowed only after weighing the implications. |
| "MAY" | "OPTIONAL" | Genuinely optional; no preference implied. |

## The cycle

`/address` is the entry point that drives one unit of work — a GitHub issue,
a pull request, or a free-form prompt — through this cycle end-to-end (see
[.claude/skills/address/SKILL.md](.claude/skills/address/SKILL.md)); the
phases below are what it composes.

Every unit of work follows `plan → implement → self-review → verify → report`.
Before planning, you MUST classify the request (bugfix, feature, refactor,
docs, triage) and define success criteria, affected surface, and verification
expectations, then inspect only the minimal context that classification needs.

1. **Plan** — clarify intent and design before coding. Scope the work with
   `to-prd` / `to-issues`, then pressure-test the plan against the domain model
   with `grill-with-docs`.
2. **Implement** — write the change test-first where there's runtime behavior,
   staying within the narrowest scope that satisfies the request (SHOULD). →
   `tdd`.
3. **Self-review** — you MUST reset into reviewer mode and read your own diff
   — judging the actual diff, not your intent — as a distinct phase before
   asking anyone else. → `code-review-guideline` (in this repo, at
   [.claude/skills/code-review-guideline/SKILL.md](.claude/skills/code-review-guideline/SKILL.md)).
   See [Review Independence Gates](#review-independence-gates).
4. **Verify** — *(no skill)* you MUST run the verify commands and report the
   actual output, not a claim — see [Verify](#verify).
5. **Report** — you MUST summarize, at completion: changed files,
   verification status, trade-offs, residual risk, and deferred follow-ups;
   and state whether skill maintenance (see
   [Skill Maintenance](#skill-maintenance)) was done, skipped, or blocked.
   Progress updates SHOULD stay concise and decision-focused; detailed
   command/iteration logs are OPTIONAL — include them only when asked or
   outcome-critical. Ask a concrete question when a decision needs product,
   scope, or domain input you can't infer.

## Review Independence Gates

A single agent cannot self-certify non-trivial work. The self-review step in
[The cycle](#the-cycle) MUST be a distinct reset into reviewer mode against
`git diff` — judge the diff and observed behavior, not what you meant to do —
and Critical/Major findings from it MUST be fixed before you report. High-risk
changes (migrations, data loss, auth — see [Escalation](#escalation)) MUST
additionally route through the independent reviewer described in
[Verify](#verify) before the work is reported done.

## Skill routing

| When you're… | Use |
| --- | --- |
| Delivering a unit of work end-to-end (issue, PR, or prompt) | `/address` (orchestrates the phases below) |
| Turning an idea into scoped work | `to-prd` → `to-issues` |
| Charting or executing a large, multi-ticket effort | `wayfinder` — tickets tracked per [Wayfinding operations](docs/agents/issue-tracker.md#wayfinding-operations) |
| Pressure-testing a plan against the domain | `grill-with-docs` |
| Triaging an incoming issue | `triage` |
| Writing code or a bugfix | `tdd` |
| Chasing a bug, test failure, or surprise | `diagnose` |
| Refactoring or improving structure | `improve-codebase-architecture` |
| Zooming out to the whole system | `zoom-out` |
| Suspending work across sessions | `handoff` |
| Self-reviewing, or reviewing a PR | `code-review-guideline` (in-repo) |
| Verifying | *(no skill — see [Verify](#verify) and [Review Independence Gates](#review-independence-gates))* |

## Skill Maintenance

The [Skill routing](#skill-routing) table is the source of truth for which
skill covers which phase — you SHOULD update it whenever a skill is added,
renamed, or dropped from the matt-pocock suite, and a routing entry MUST NOT
duplicate guidance that already lives in the skill itself. When authoring or
editing a skill, consult `write-a-skill`. The matt-pocock skills live in an
external suite (`~/.agents/skills`), so "maintenance" here mostly means
keeping this table and the inline *(no skill)* prose current, not editing
upstream skills. Propose an update when a task exposes a reusable convention,
outdated guidance, or a recurring review finding (SHOULD); state in the
report when maintenance was skipped for lack of generalizable learning (MUST
— see [The cycle](#the-cycle)).

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

An independent, advisory CI reviewer runs on demand: comment `@claude review` on
a PR (owner/member/collaborator only) to trigger it — see
[.github/workflows/claude-review.yaml](.github/workflows/claude-review.yaml).
It follows the same methodology you do —
[.claude/skills/code-review-guideline/SKILL.md](.claude/skills/code-review-guideline/SKILL.md)
— under the posted-review policy in [REVIEW.md](REVIEW.md), which wins on
conflict.

## Conventions

- **Branches:** `<prefix>/issue-<number>-<short-description>` (`feat/`, `bugfix/`,
  `doc/`). One issue per branch — never mix issues.
- **Worktrees:** work each issue in its own git worktree.
- **Syncing:** `git rebase origin/main`. Never `git merge main` or a plain
  `git pull` on a feature branch.
- **Rewriting pushed history:** rebasing a branch that has already been pushed
  rewrites its commits, so the follow-up push MUST be
  `git push --force-with-lease` (never bare `--force`, which will clobber a
  push you have not seen). An agent MUST ask the maintainer before rewriting
  history on a pushed branch — including rebase, `--force-with-lease`,
  `commit --amend`, and `reset --hard` — even when a reviewer or the Syncing
  rule above calls for the rebase. The decision is the maintainer's: undoing a
  force-push takes another force-push, and it can strand review threads.
- **Commits/PRs:** open a PR per issue; link it to the issue it addresses.

## Escalation

Changes touching **migrations, data loss, or auth** warrant extra review and a
short ADR in `docs/adr/` recording the decision. Design specs live in
`docs/superpowers/specs/`.
