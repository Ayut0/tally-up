---
name: address
description: Thin orchestrator that drives one unit of work (a GitHub issue, a pull request, or a free-form prompt) through this repo's plan/implement/self-review/verify/report cycle to a review-ready PR, composing the tdd and handoff skills instead of reimplementing them. Use when asked to address/deliver/work an issue or PR end-to-end, or to resume one with `continue`.
argument-hint: <issue-or-pr number/URL | free-form prompt | continue>
---

# Address

Thin orchestrator for AGENTS.md's cycle (`plan → implement → self-review →
verify → report`). It resolves what `$ARGUMENTS` names, drives it through
that cycle, opens a PR, requests the independent review, and addresses
findings. It does not restate any phase's rules — see AGENTS.md, `tdd`, and
`handoff` for those.

## Resolve the argument

| `$ARGUMENTS` | Meaning | Start at |
| --- | --- | --- |
| Issue number/URL | Plan and deliver that issue | Plan |
| PR number/URL | Resume an open PR — read its diff, CI, and existing review comments before continuing | Wherever that state points (Verify, or Address) |
| Free-form prompt | Ad hoc task with no issue yet | Open a tracking issue (`gh issue create`, per docs/agents/issue-tracker.md), then Plan |
| `continue` (bare) | Resume — see [Resuming](#resuming) | Wherever the resumed state points |

Assume the operator has already checked out the branch/worktree for the
target, per AGENTS.md's worktree convention — this skill MUST NOT create
one.

## Plan

Read the issue/PR (`gh issue view <n> --comments` / `gh pr view <n>`) and
linked docs (docs/mapping.md, docs/architecture.md, relevant ADRs). If the
spec leaves a genuine product/UX/scope decision unstated, you MUST ask the
human before writing the plan — you MUST NOT guess.

Use Claude Code's plan mode for the plan-approval gate: enter it, write the
plan, then exit it for approval. You MUST NOT proceed to Implement until the
human approves — this is AGENTS.md's "Plan" phase, backed by the harness's
native plan mode instead of a bespoke protocol.

## Implement, self-review, verify

- **Implement** — hand the approved plan to the `tdd` skill for the
  red-green-refactor loop.
- **Self-review** — reset into reviewer mode and read the diff before
  opening the PR, judging the diff itself rather than your intent (AGENTS.md's
  [Review Independence Gates](../../../AGENTS.md#review-independence-gates) —
  no dedicated skill).
- **Verify** — run the commands AGENTS.md's Verify section names (`make
  db-up`, `make test`, `go vet ./...`) and carry the actual output into the
  PR body, not a claim. If a change touches no Go code, say so instead of
  running them for form's sake.

## Open the PR and request review

- `gh pr create` with `Closes #<n>`, a summary, and the verification
  output, per docs/agents/issue-tracker.md conventions.
- Trigger the independent reviewer yourself: it is comment-triggered only
  (auto-dispatch on PR-open is tracked separately in #77 and not yet
  built) — `gh pr comment <n> --body "@claude review"`.

## Address findings

Once the review posts (check `gh pr view <n> --comments` a few minutes
after triggering), fix every blocking finding, re-run whatever verify
commands the fix touches, push, and re-trigger with the same comment. You
MUST cap this loop at 5 rounds; on the 5th without convergence, you MUST
stop and report to the human instead of retrying again — a stuck review
needs a human call.

## Resuming (`continue`)

There's no separate state machine — this session's context is the record
of where a run is. `continue` means: re-read the target's current state
(issue/PR body, comments, CI, review threads) and resume the one pending
step, rather than restarting. If the human instead hands over a `/handoff`
document from another session, treat it as the resume point (its own
"suggested skills" section may point back here).

## Report

Summarize outcome, verification evidence, and any open follow-ups, per
AGENTS.md's cycle step 5 — no dedicated skill.
