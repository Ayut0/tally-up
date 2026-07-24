# CI Independent-Review Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a comment-triggered, advisory independent-review workflow for tally-up PRs.

**Architecture:** A `.github/workflows/claude-review.yaml` fires on `issue_comment` when a trusted user comments `@claude review` on a PR, runs the official `code-review` plugin via `anthropics/claude-code-action@v1` (base-ref checkout, `contents: read`, synchronous one-turn review), and posts inline comments + a summary. A repo-root `REVIEW.md` supplies the tally-up review lens; AGENTS.md gains a one-line pointer.

**Tech Stack:** GitHub Actions, `anthropics/claude-code-action@v1`, the `code-review@claude-code-plugins` plugin, `CLAUDE_CODE_OAUTH_TOKEN` subscription auth.

## Global Constraints

- Preserve the template's **three load-bearing safety properties** verbatim: (1) author-association gate + `@claude review` phrase + `github.event.issue.pull_request`; (2) base-ref checkout (never PR head); (3) `--disallowedTools "WebFetch,WebSearch,Task"`.
- Reviewer is **advisory** — never a required check; token is `contents: read`.
- Auth secret is `CLAUDE_CODE_OAUTH_TOKEN` (subscription), never an API key input.
- No Go toolchain / build / test step in the workflow — it is a reading review over the GitHub-API diff.
- Strip all `/address` and `.claude/skills/address/SKILL.md` references — neither exists in this repo.
- Design spec of record: `docs/superpowers/specs/2026-07-24-ci-independent-review-design.md`.

---

### Task 1: REVIEW.md review policy

The workflow's `--append-system-prompt` tells the reviewer to read this file, so it must exist first.

**Files:**
- Create: `REVIEW.md`

**Interfaces:**
- Produces: a repo-root `REVIEW.md` the workflow references by name.

- [ ] **Step 1: Create `REVIEW.md`**

```markdown
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
```

- [ ] **Step 2: Verify referenced paths exist**

Run: `for f in AGENTS.md docs/mapping.md docs/development.md docs/adr; do test -e "$f" && echo "OK $f" || echo "MISSING $f"; done`
Expected: all `OK` (no `MISSING`).

- [ ] **Step 3: Commit**

```bash
git add REVIEW.md
git commit -m "docs: add tally-up REVIEW.md policy for CI reviewer (#70)"
```

---

### Task 2: claude-review.yaml workflow

**Files:**
- Create: `.github/workflows/claude-review.yaml`

**Interfaces:**
- Consumes: `REVIEW.md` (Task 1); the `CLAUDE_CODE_OAUTH_TOKEN` repo secret (operator-provided).

- [ ] **Step 1: Create `.github/workflows/claude-review.yaml`**

```yaml
name: Claude Code Review

# Independent, advisory pull-request review for tally-up.
#
# Runs as a SEPARATE Claude Code session on a GitHub-hosted runner — a different
# session, on different infrastructure, under a bot identity distinct from
# whoever authored the PR — so it is structurally positioned to catch what the
# author's own local review rationalised past. It is ADVISORY: it never gates
# merges and its token is read-only.
#
# Trigger: a comment containing `@claude review` on a pull request, from a
# trusted user (owner/member/collaborator). Nothing runs until someone asks. The
# reviewer reads REVIEW.md at the repo root as its review policy.
#
# NOTE: issue_comment workflows run only from the version on the DEFAULT branch,
# so this reviewer fires on PRs only once this file is merged to `main` — the PR
# that introduces it cannot be reviewed by it.
#
# One-time operator setup (the workflow no-ops until both are done):
#   1. Install the Claude GitHub App: https://github.com/apps/claude
#   2. Generate a subscription token with `claude setup-token` and add it as the
#      repo secret CLAUDE_CODE_OAUTH_TOKEN
#      (Settings → Secrets and variables → Actions).

on:
  issue_comment:
    types: [created]

# Least privilege: contents:read only — the reviewer reads code and writes review
# output, and its token cannot push. pull-requests / issues / checks writes cover
# inline comments, the summary comment, and the check-run respectively.
permissions:
  contents: read
  pull-requests: write
  issues: write
  checks: write
  id-token: write # claude-code-action mints the Claude App token via OIDC

jobs:
  review:
    name: Review
    # SAFETY 1 — author-association gate. Fire only on a comment on a PR (not a
    # plain issue), containing the trigger phrase, from a trusted user. Keeps
    # untrusted authors from spending tokens or steering the reviewer.
    if: >-
      github.event.issue.pull_request &&
      contains(github.event.comment.body, '@claude review') &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')
    # Job-level (not workflow-level) concurrency: only a job that passes the `if`
    # gate joins the group, so an unrelated issue_comment cannot cancel an
    # in-flight review. A fresh trigger comment still supersedes a running one.
    concurrency:
      group: claude-review-${{ github.event.issue.number }}
      cancel-in-progress: true
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      # SAFETY 2 — base-ref checkout. Check out the default branch, NEVER the PR
      # head: the review reads the diff through the GitHub API, so untrusted head
      # code is never executed on the runner. The checkout only supplies trusted
      # review context (AGENTS.md, CLAUDE.md, REVIEW.md).
      - name: Checkout
        uses: actions/checkout@v4

      - name: Claude Review
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          # Run the official code-review plugin against this PR. It posts only
          # when invoked with `--comment`: inline comments via
          # mcp__github_inline_comment__create_inline_comment plus one
          # `gh pr comment` summary. It never submits a formal `gh pr review`.
          plugin_marketplaces: "https://github.com/anthropics/claude-code.git"
          plugins: "code-review@claude-code-plugins"
          prompt: "/code-review:code-review https://github.com/${{ github.repository }}/pull/${{ github.event.issue.number }} --comment"
          # --allowedTools is REQUIRED: the action does not honor a plugin
          # command's own allowed-tools frontmatter. Broad Bash (not a narrow
          # allow-list) is needed because the plugin issues compound shell
          # commands to gather context; it is safe ONLY because the runner holds
          # the trusted base tree (never the PR head, SAFETY 2) and the token is
          # contents:read, so no untrusted code runs and nothing can be pushed.
          claude_args: >-
            --append-system-prompt "Read REVIEW.md at the repository root and follow it as the highest-priority, review-only instructions for this review. Review this pull request even if it is a draft — do not skip it for being a draft. Do the ENTIRE review within this single turn: run every check and review pass yourself, synchronously and in order. Do NOT kick off background or parallel work and then end your turn to wait for it — this is a one-shot job that terminates the instant your turn ends, so anything you defer is lost and no review is posted. You MUST post your findings (inline comments plus a summary via `gh pr comment`) before your turn ends. This reviewer is advisory and does not gate merges."
            --allowedTools "mcp__github_inline_comment__create_inline_comment,Read,Grep,Glob,Bash"
            --disallowedTools "WebFetch,WebSearch,Task"
            --max-turns 200
          # SAFETY 3 — background-task denial (--disallowedTools). Denying Task
          # forces a synchronous review that posts within the one turn; the
          # plugin otherwise fans passes out to background sub-agents that get
          # orphaned when this single-shot action ends, and nothing posts.
          # WebFetch/WebSearch stay denied — no external calls from the reviewer.
          # --max-turns guards against a pathological loop; timeout-minutes is
          # the real backstop.
```

- [ ] **Step 2: Validate YAML parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/claude-review.yaml')); print('yaml ok')"`
Expected: `yaml ok`

- [ ] **Step 3: Lint the workflow (if actionlint available)**

Run: `command -v actionlint >/dev/null && actionlint .github/workflows/claude-review.yaml && echo "actionlint clean" || echo "actionlint not installed — skipping"`
Expected: `actionlint clean` or the skip message (no reported errors).

- [ ] **Step 4: Confirm the three safety properties are present**

Run: `grep -c "author_association" .github/workflows/claude-review.yaml; grep -c "actions/checkout" .github/workflows/claude-review.yaml; grep -c "disallowedTools" .github/workflows/claude-review.yaml`
Expected: each `grep -c` prints `1` (gate, base-ref checkout, background-task denial all present).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/claude-review.yaml
git commit -m "feat: add comment-triggered independent-review workflow (#70)"
```

---

### Task 3: AGENTS.md pointer

**Files:**
- Modify: `AGENTS.md` (Verify section)

**Interfaces:**
- Consumes: the workflow path from Task 2.

- [ ] **Step 1: Add a pointer after the Verify paragraph**

After the existing Verify paragraph (ending `plus `go vet ./...`.`), add:

```markdown

An independent, advisory CI reviewer runs on demand: comment `@claude review` on
a PR (owner/member/collaborator only) to trigger it — see
[.github/workflows/claude-review.yaml](.github/workflows/claude-review.yaml) and
the review lens in [REVIEW.md](REVIEW.md).
```

- [ ] **Step 2: Verify the edit landed once**

Run: `grep -c "@claude review" AGENTS.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: point AGENTS.md at the CI reviewer (#70)"
```

---

## Post-merge verification (not a task — operator-run after merge)

Per the spec: `issue_comment` runs only from the default branch, so #70's own PR
can't self-review. After merge to `main` and operator setup (GitHub App +
`CLAUDE_CODE_OAUTH_TOKEN`): open a trivial throwaway PR, comment `@claude review`,
confirm inline comments + a summary post, confirm a phrase-less / untrusted
comment does **not** trigger it, then close the throwaway PR.
