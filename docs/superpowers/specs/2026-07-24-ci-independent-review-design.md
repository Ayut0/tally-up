# CI independent-review channel for PRs — design

- **Issue:** [#70](https://github.com/Ayut0/tally-up/issues/70) (follow-up to #68)
- **Date:** 2026-07-24
- **Status:** approved, pending implementation

## Problem

tally-up's review discipline lives only in the maintainer's local tooling (the
`/code-review` skill run by hand before opening a PR). That review is run by the
*same* operator and agent that wrote the change, on the same machine — so it
inherits the author's blind spots and rationalisations, and a plugin-less
teammate or CI runner has no review channel at all. There is no committed,
independent review anchored to the PR itself.

Issue #68 adopted the `axross/claude-loop-template` working agreement but
explicitly deferred the template's `claude-review.yaml` GitHub-Actions workflow,
because the repo had no `.github/workflows/` and adding one is a separate
infrastructure decision (secrets, cost, trigger scope). #70 is that decision.

## Decision

Add a **comment-triggered, advisory** independent-review workflow, adapted from
the template to this repo's reality (which has **no `/address` skill and no
`REVIEW.md`**).

Decisions locked during brainstorming:

| Dimension | Choice | Rationale |
| --- | --- | --- |
| Add it at all? | **Yes** | Independent second-session review is additive to the local `/code-review`; cheap to keep dormant. |
| Trigger | **Comment `@claude review` on a PR** | On-demand, cost-controlled; the maintainer decides per-PR when to spend a review. No auto-run on every push. |
| Auth / billing | **`CLAUDE_CODE_OAUTH_TOKEN`** (subscription) | No pay-as-you-go metering; matches the template default. |
| Review policy | **Short `REVIEW.md`** tuned to tally-up | Reviewer loads it as highest-priority instructions; keeps findings on-domain (DDD boundaries, sqlc, ADR triggers). |
| Merge gating | **Advisory only** | `contents: read`; never a required check. Low blast radius. |
| Discoverability | **One-line pointer in AGENTS.md** | Keeps the working agreement complete. |

## Components

### 1. `.github/workflows/claude-review.yaml`

Adapted from the template, **preserving its three load-bearing safety
properties verbatim**:

1. **Author-association gate + trigger phrase.** The job's `if` fires only when
   the event is a comment *on a PR* (`github.event.issue.pull_request`),
   containing `@claude review`, from an `OWNER`/`MEMBER`/`COLLABORATOR`. Keeps
   untrusted authors from spending tokens or steering the reviewer.
2. **Base-ref checkout.** `actions/checkout@v4` checks out the default branch,
   never the PR head. The review reads the diff through the GitHub API, so
   untrusted head code never executes on the runner; the checkout only supplies
   trusted review context (`AGENTS.md`, `CLAUDE.md`, `REVIEW.md`).
3. **Background-task denial.** `--disallowedTools "WebFetch,WebSearch,Task"`
   forces a synchronous one-turn review that posts before the turn ends, instead
   of orphaning background sub-agents when the single-shot action terminates.

Concrete shape:

- `on: issue_comment: types: [created]`
- `permissions:` `contents: read`, `pull-requests: write`, `issues: write`,
  `checks: write`, `id-token: write` (OIDC for the Claude App token).
- Job-level `concurrency: claude-review-${{ github.event.issue.number }}`,
  `cancel-in-progress: true`. Job-level (not workflow-level) so unrelated
  `issue_comment` events that fail the `if` gate can't cancel an in-flight
  review.
- `runs-on: ubuntu-latest`, `timeout-minutes: 30` (the real backstop).
- Engine: `anthropics/claude-code-action@v1` running the official `code-review`
  plugin with `--comment` → inline comments via
  `mcp__github_inline_comment__create_inline_comment` + one `gh pr comment`
  summary. `--allowedTools` includes broad `Bash` (safe only because of safety
  property 2 + `contents: read`), `Read`, `Grep`, `Glob`. `--max-turns 200`.
- `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`.
- `--append-system-prompt` instructs the reviewer to read `REVIEW.md` as the
  highest-priority, review-only policy; review drafts too; complete the whole
  review in one synchronous turn; and post before the turn ends. States plainly
  that the reviewer is **advisory and does not gate merges**.

**Adaptations from the template (documented in the header comment):**

- **Strip all `/address` and `.claude/skills/address/SKILL.md` references** —
  neither exists in tally-up. The trigger is a **human** commenting
  `@claude review`, not an automated `/address` post.
- **No Go toolchain step.** This is a *reading* review over the GitHub-API diff
  plus the base tree; it does not compile or run tests. (Compilation/tests are
  the author's `make test` / `go vet` verify step, not the reviewer's job.)
- Keep the `INIT` marker note only as much as needed; the header should read as
  tally-up's own file, not a template artefact.
- Keep the **default-branch caveat**: `issue_comment` workflows run only from
  the version on the default branch, so this reviewer starts working on PRs
  **only after this file is merged to `main`** — it cannot review its own
  introducing PR.

### 2. `REVIEW.md` (repo root)

~30-line review policy the workflow loads as highest-priority instructions.
Content (tally-up-specific, correctness-focused):

- **Scope & stance:** advisory, correctness-first; prefer a few high-confidence
  findings over noise; don't re-litigate style the tooling already enforces.
- **DDD boundaries:** respect the layer map in `docs/mapping.md`; flag
  dependencies that point the wrong way across domain/application/infrastructure/
  interface boundaries.
- **sqlc:** never hand-edit generated query code; schema/query changes go through
  `make sqlc` regeneration.
- **Escalation triggers:** changes touching **migrations, data loss, or auth**
  warrant an ADR in `docs/adr/` — flag when one is missing.
- **Verify commands are the source of truth:** `make db-up` + `make test`, plus
  `go vet ./...` (per `docs/development.md`); the reviewer notes when a change
  needs verification it can't itself run.
- Points to `AGENTS.md` for the full working agreement rather than duplicating it.

### 3. `AGENTS.md` — one-line pointer

Add a single line (near **Verify**) noting that commenting `@claude review` on a
PR triggers an independent, advisory CI review. Keeps the working agreement the
single discoverable index.

## Operator setup (one-time; workflow no-ops until done)

1. Install the Claude GitHub App: <https://github.com/apps/claude>.
2. Generate a subscription token with `claude setup-token` and add it as the
   repo secret `CLAUDE_CODE_OAUTH_TOKEN`
   (Settings → Secrets and variables → Actions).

Documented in the workflow header so the file is self-explanatory.

## Out of scope

- **Merge-gating** — reviewer stays advisory; no required status check.
- **Auto-triggering** on `pull_request` open/synchronize — comment-triggered only.
- **The `/address` auto-post loop** and the `/handoff` command — not present in
  this repo.
- Any Go build/test execution inside the reviewer.

## Verification plan

Because `issue_comment` workflows run only from the default branch, #70's own PR
cannot self-review. Plan:

1. Statically validate the workflow YAML locally (parse + `actionlint` if
   available) and reason through the `if` gate conditions.
2. Merge #70 to `main`.
3. Complete operator setup (GitHub App + `CLAUDE_CODE_OAUTH_TOKEN`).
4. Open a trivial throwaway PR; comment `@claude review`.
5. Confirm the reviewer fires and posts inline comments + a summary; confirm a
   comment from a non-trusted association (or without the phrase) does **not**
   trigger it.
6. Close the throwaway PR.

## Risks

- **Low.** CI/config only, no application code. `contents: read` means the
  reviewer cannot push. The main residual risk is token spend, bounded by the
  comment trigger + author-association gate + 30-min timeout.
