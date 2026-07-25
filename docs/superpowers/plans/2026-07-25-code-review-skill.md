# Code-Review Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tally-up one written review methodology that both the local
self-review phase and the CI reviewer follow, and slim `REVIEW.md` down to the
posted-artifact policy that genuinely differs.

**Architecture:** A new in-repo skill at
`.claude/skills/code-review-guideline/SKILL.md` owns *how* to review. `REVIEW.md`
keeps only what is true of a **posted** review and wins on conflict. `AGENTS.md`
routes the cycle's self-review step at the skill; the CI workflow gains one
clause so the runner loads it. Nothing in `internal/`, `cmd/`, or the Makefile
is touched.

**Tech Stack:** Markdown, YAML frontmatter, GitHub Actions.

**Spec:** [`docs/superpowers/specs/2026-07-25-code-review-skill-design.md`](../specs/2026-07-25-code-review-skill-design.md)

## Global Constraints

- Issue: [#79](https://github.com/Ayut0/tally-up/issues/79). Branch
  `feat/issue-79-code-review-skill`. One issue per branch.
- Requirement-level keywords (**MUST**, **MUST NOT**, **SHOULD**, **MAY**) are
  used in the RFC-2119 sense. The table defining them lands with #78 — do not
  add it here.
- **No external-repo references** in any file this plan writes.
- **One home per rule.** The verify commands live in `docs/development.md` and
  are cited, never restated. Lenses live in the skill, never in `REVIEW.md`.
- Skill frontmatter uses Claude Code fields only: `name`, `description`. No
  `when_to_use:`, no `user-invocable:`, no slash command.
- This change is docs/config only. It MUST NOT modify the Makefile, add a
  `scripts/` directory, or touch Go source.
- Verify commands are defined in
  [`docs/development.md`](../../development.md) — `make db-up`, then `make test`,
  plus `go vet ./...`.

**Why there are no unit tests in this plan:** the deliverables are Markdown and
YAML with no runtime behavior, so there is nothing to red-green. Each task
substitutes a mechanical check (`grep`, `yq`, `gh`) whose expected output is
written out, and the suite is run at the end to prove nothing regressed. Do not
invent Go tests for these files.

---

### Task 1: Create the review-methodology skill

**Files:**
- Create: `.claude/skills/code-review-guideline/SKILL.md`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the path
  `.claude/skills/code-review-guideline/SKILL.md`, cited verbatim by Task 2
  (`REVIEW.md`), Task 3 (`AGENTS.md`), and Task 4 (the workflow). The skill's
  `name:` field is `code-review-guideline`; later tasks refer to it by that
  exact string.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .claude/skills/code-review-guideline
```

- [ ] **Step 2: Write the skill**

Write this to `.claude/skills/code-review-guideline/SKILL.md`:

````markdown
---
name: code-review-guideline
description: Review methodology for tally-up — reviewer-mode reset, diff scoping, the severity ladder, evidence format, and this repo's DDD and sqlc lenses. Use at the start of any review task: the self-review phase of the cycle, reviewing a pull request, auditing a change, or checking your own diff before calling work done.
---

# Code review guideline

How to review a change in tally-up. This applies to every review, whether the
output is a posted pull-request review or your own self-review of a diff you
just wrote.

When the review **is posted** — the CI reviewer in
[`.github/workflows/claude-review.yaml`](../../../.github/workflows/claude-review.yaml) —
[`REVIEW.md`](../../../REVIEW.md) governs the posted artifact and **wins on
conflict**. This file still governs the method.

> The dividing rule: a rule that is true whether or not anyone else sees the
> review belongs here. A rule about the posted artifact belongs in `REVIEW.md`.

## Reviewer-mode reset

Self-review is not independent review. It only works if you deliberately stop
being the author first.

- You MUST stop editing before you start reviewing. Review and implementation
  are separate phases.
- You MUST reread the issue and its acceptance criteria before reading the diff.
- You MUST read the diff *before* the surrounding files, so you see what
  changed rather than what you meant.
- You MUST judge the diff and its behavior, not your intent. "I know why I did
  that" is not a finding's answer.
- After fixing any **Critical** or **Major** finding you MUST re-review — the
  fix is new code that nobody has reviewed.

## Scoping the diff

- You MUST establish scope before reporting anything:

  ```bash
  git status                        # untracked files count as part of the change
  git diff origin/main...HEAD       # the branch's own work
  gh pr diff <n>                    # when reviewing someone else's PR
  ```

- Use **three dots**. This repo rebases onto `origin/main` and never merges, so
  `git diff origin/main..HEAD` would mix unrelated `main` drift into your diff.
- In scope: the diff, and behavior the diff affects.
- Out of scope: problems that predate the diff. You MAY note them, but you MUST
  report them separately — never folded into the diff's findings.

## Severity ladder

Four internal tiers. These drive *your* decisions; see the posted-review
section below for what actually gets published.

| Tier | In this repo |
| --- | --- |
| **Critical** | Ledger correctness — double-entry that does not balance, amount handling. Data loss in a migration. Auth bypass. Hand-edits to sqlc-generated code. |
| **Major** | A dependency pointing the wrong way across a DDD layer. Domain logic in `interfaces/rest` or `infrastructure/postgres`. A missing ADR on an escalation trigger. New runtime behavior with no test. |
| **Minor** | Unclear naming that survives review. An error returned without context. A non-table-driven test whose siblings are table-driven. |
| **Nit** | Typos, ordering, comment wording. |

- Any **Critical** or **Major** finding MUST be fixed and re-reviewed before
  the change is called done.
- **Minor** and **Nit** findings SHOULD be fixed, but MAY be deferred with a
  note.
- The Approve / Request Changes verdict vocabulary is internal. It MUST NOT
  appear in a posted review.

## Evidence

A finding without evidence is an opinion.

- Every finding MUST cite `file:line`.
- Every finding MUST state **what** is wrong, **why** it matters, and the
  **smallest** fix.
- Where a fix is concrete, you MUST show it as a diff snippet:

  ```diff
  - if err != nil { return err }
  + if err != nil { return fmt.Errorf("load group %s: %w", id, err) }
  ```

- You MUST NOT report a finding you cannot locate. If you suspect a problem but
  cannot anchor it, say so explicitly as a question, not as a finding.

## Verification

- You MUST report the **actual output** of the verify commands, or state
  plainly which ones you skipped and why. "Tests pass" without output is not a
  verification claim.
- The commands live in [`docs/development.md`](../../../docs/development.md).
  This file deliberately does not restate them — one home per rule.
- When a change needs verification you cannot run, you MUST say so rather than
  assume it passes.

## tally-up lenses

Apply the lenses that materially overlap the diff.

### DDD boundaries

The layer map is [`docs/mapping.md`](../../../docs/mapping.md).

- Flag dependencies pointing the wrong way across
  `domain/` → `application/` → `infrastructure/` → `interfaces/`.
- Flag domain logic that has leaked into a handler (`interfaces/rest`) or into
  persistence (`infrastructure/postgres`).

### sqlc

- You MUST NOT approve hand-edits to generated query code — the next
  `make sqlc` erases them.
- Schema and query changes belong in
  `internal/infrastructure/postgres/query/*.sql` plus a regeneration, not in
  the generated files.
- Flag a changed `query/*.sql` whose generated output was not regenerated.

### Escalation triggers

- Changes touching **migrations, data loss, or auth** MUST carry a short ADR in
  [`docs/adr/`](../../../docs/adr/). Flag a missing one.

### Branch hygiene

- One issue per branch. Flag a diff that mixes work for a second issue.

## Posted reviews

When the output is a posted PR review, [`REVIEW.md`](../../../REVIEW.md) is
authoritative and overrides this file wherever they differ. In particular it
owns the label set, the tally line, and the do-not-report list. Read it before
posting.

## Escalation

- A review is **report-only**. You MUST NOT mutate the codebase while
  reviewing — fixes belong to a following implementation phase.
- When a finding needs the author's judgment rather than a fix, report it as a
  `Decision needed:` entry.
- When you hit the same gap repeatedly because the written guidance is silent,
  report it as a `Guideline gap:` note so the guidance gets fixed instead of
  the symptom.
- High-risk changes (migrations, data loss, auth) MUST NOT be called
  merge-ready on the strength of a self-review alone.
````

- [ ] **Step 3: Verify the frontmatter parses and uses only Claude Code fields**

Run:

```bash
awk '/^---$/{n++; next} n==1' .claude/skills/code-review-guideline/SKILL.md
```

Expected: exactly two lines, `name:` and `description:`. No `when_to_use:`, no
`user-invocable:`.

- [ ] **Step 4: Verify every relative link resolves**

Run:

```bash
cd .claude/skills/code-review-guideline && \
  grep -o '(\.\./[^)]*)' SKILL.md | tr -d '()' | sort -u | \
  while read -r p; do [ -e "$p" ] && echo "OK   $p" || echo "DEAD $p"; done; cd - >/dev/null
```

Expected: every line starts `OK`. Any `DEAD` line is a broken path — fix it
before committing.

- [ ] **Step 5: Verify the constraints hold**

Run:

```bash
grep -c 'make test\|make db-up\|go vet' .claude/skills/code-review-guideline/SKILL.md
```

Expected: `0` — the skill cites `docs/development.md` and restates no commands.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/code-review-guideline/SKILL.md
git commit -m "feat: add in-repo code-review-guideline skill (#79)"
```

---

### Task 2: Slim REVIEW.md to posted-review policy

**Files:**
- Modify: `REVIEW.md` (full rewrite, 36 lines → ~55 lines)

**Interfaces:**
- Consumes: the skill path from Task 1.
- Produces: the label strings **Important** and **Nit**, and the tally-line
  format `N Important, M Nits`, both relied on by Task 5's verification.

- [ ] **Step 1: Read the current file so the move is deliberate**

Run: `cat REVIEW.md`

The `## What to weigh` block (DDD boundaries, sqlc, escalation triggers,
verification) is what moves out — Task 1 already carries it. Confirm nothing
in that block is missing from the skill before deleting it here.

- [ ] **Step 2: Replace REVIEW.md entirely**

Write this to `REVIEW.md`:

```markdown
# tally-up — review policy

Highest-priority instructions for a **posted** review — the independent CI
reviewer (`.github/workflows/claude-review.yaml`, triggered by `@claude review`
on a pull request). This file governs the posted artifact only.

*How* to review — reviewer-mode reset, diff scoping, the severity ladder,
evidence format, and this repo's DDD and sqlc lenses — lives in
[`.claude/skills/code-review-guideline/SKILL.md`](.claude/skills/code-review-guideline/SKILL.md).
Where that file and this one disagree about a posted review, **this file wins**.

> The dividing rule: a rule that is true whether or not anyone else sees the
> review belongs in the skill. A rule about the posted artifact belongs here.

For the full working agreement see [AGENTS.md](AGENTS.md).

## Stance

- **Advisory.** The reviewer MUST NOT gate merges — leave the merge decision to
  a human.
- The review MUST be COMMENT-type. Never `APPROVE`, never `REQUEST_CHANGES`.
- Prefer a few high-confidence findings over noise.

## Labels

Every posted finding MUST carry exactly one label:

| Label | Meaning |
| --- | --- |
| **Important** | Act on this before merge. |
| **Nit** | Optional — the author MAY ignore it. |

- The summary MUST open with a one-line tally: `2 Important, 3 Nits`.
- The skill's internal ladder MUST NOT appear in posted output. Critical and
  Major collapse to **Important**; Minor and Nit collapse to **Nit**.
- An acceptance criterion of the linked issue that the diff leaves unmet or
  unverifiable MUST be reported **Important**.
- There is no nit cap — report every finding. Repeated identical nits MAY share
  a single comment.

## Do not report

- Anything the tooling already enforces: `gofmt`, `go vet`.
- Generated files and lockfiles. Flag the *source* change instead — a
  `query/*.sql` edit, or `sqlc.yaml`.
- Pre-existing problems the diff does not touch.

## Out of scope

- Running the build or test suite. The reviewer reads the diff and the base
  tree. When a change needs verification the reviewer cannot run, it MUST say
  so rather than assume it passes.
```

- [ ] **Step 3: Verify no lens survived the move**

Run:

```bash
grep -in 'mapping.md\|DDD\|boundaries\|make sqlc\|docs/adr' REVIEW.md || echo "CLEAN: no lenses left in REVIEW.md"
```

Expected: `CLEAN: no lenses left in REVIEW.md`. Any hit is duplication with the
skill — delete it here, since the skill owns it.

- [ ] **Step 4: Verify the skill link resolves**

Run: `ls .claude/skills/code-review-guideline/SKILL.md`

Expected: the path prints. A broken link here silently strands the methodology.

- [ ] **Step 5: Commit**

```bash
git add REVIEW.md
git commit -m "refactor: slim REVIEW.md to posted-review policy (#79)"
```

---

### Task 3: Route AGENTS.md at the skill

**Files:**
- Modify: `AGENTS.md` — the cycle's step 3, the skill-routing table row, and the
  `## Verify` section's reviewer paragraph.

**Interfaces:**
- Consumes: the skill name `code-review-guideline` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Replace the cycle's self-review step**

Find:

```markdown
3. **Self-review** — *(no skill)* reset into reviewer mode and read your own diff
   before asking anyone else.
```

Replace with:

```markdown
3. **Self-review** — reset into reviewer mode and read your own diff before
   asking anyone else. → `code-review-guideline` (in this repo, at
   [.claude/skills/code-review-guideline/SKILL.md](.claude/skills/code-review-guideline/SKILL.md)).
```

- [ ] **Step 2: Split the routing-table row**

Find:

```markdown
| Self-reviewing or verifying | *(no skill — see [The cycle](#the-cycle))* |
```

Replace with:

```markdown
| Self-reviewing, or reviewing a PR | `code-review-guideline` (in-repo) |
| Verifying | *(no skill — see [Verify](#verify))* |
```

- [ ] **Step 3: Point the Verify section's reviewer paragraph at both files**

Find:

```markdown
An independent, advisory CI reviewer runs on demand: comment `@claude review` on
a PR (owner/member/collaborator only) to trigger it — see
[.github/workflows/claude-review.yaml](.github/workflows/claude-review.yaml) and
the review lens in [REVIEW.md](REVIEW.md).
```

Replace with:

```markdown
An independent, advisory CI reviewer runs on demand: comment `@claude review` on
a PR (owner/member/collaborator only) to trigger it — see
[.github/workflows/claude-review.yaml](.github/workflows/claude-review.yaml).
It follows the same methodology you do —
[.claude/skills/code-review-guideline/SKILL.md](.claude/skills/code-review-guideline/SKILL.md)
— under the posted-review policy in [REVIEW.md](REVIEW.md), which wins on
conflict.
```

- [ ] **Step 4: Verify no "(no skill)" claim remains for self-review**

Run:

```bash
grep -n 'Self-review\|Self-reviewing' AGENTS.md
```

Expected: two hits, neither containing `(no skill)`. The only remaining
`*(no skill …)*` in the file belongs to **Verify**.

- [ ] **Step 5: Verify the routing table still renders as a table**

Run:

```bash
awk '/^\| When you/,/^$/' AGENTS.md
```

Expected: every row has exactly two `|`-delimited cells and the header
separator is intact.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md
git commit -m "docs: route AGENTS.md self-review at code-review-guideline (#79)"
```

---

### Task 4: Wire the CI reviewer to load the skill

**Files:**
- Modify: `.github/workflows/claude-review.yaml` — the `--append-system-prompt`
  string inside `claude_args` (one sentence inserted; nothing else changes).

**Interfaces:**
- Consumes: the skill path from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Insert one sentence into the system prompt**

In the `--append-system-prompt` string, find:

```
Read REVIEW.md at the repository root and follow it as the highest-priority, review-only instructions for this review. Review this pull request even if it is a draft
```

Replace with:

```
Read REVIEW.md at the repository root and follow it as the highest-priority, review-only instructions for this review. Read .claude/skills/code-review-guideline/SKILL.md and follow it as the review methodology; where the two disagree, REVIEW.md wins. Review this pull request even if it is a draft
```

Change nothing else: not the trigger, not the `if:` gate, not `permissions:`,
not `--allowedTools`, not `--disallowedTools`, not `--max-turns`. The three
SAFETY properties documented in the file MUST survive untouched.

- [ ] **Step 2: Verify the YAML still parses**

Run:

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/claude-review.yaml')); print('YAML OK')"
```

Expected: `YAML OK`. A broken quote in the folded `>-` block is the likely
failure mode.

- [ ] **Step 3: Verify the safety properties are untouched**

Run:

```bash
git diff .github/workflows/claude-review.yaml | grep '^[-+]' | grep -v '^[-+][-+]'
```

Expected: exactly one `-` line and one `+` line, both the system-prompt string.
Any other changed line means something beyond the intended edit moved — revert
it.

- [ ] **Step 4: Verify the skill path in the prompt is real**

Run:

```bash
grep -o '\.claude/skills/[^ ]*SKILL\.md' .github/workflows/claude-review.yaml | \
  while read -r p; do [ -e "$p" ] && echo "OK $p" || echo "DEAD $p"; done
```

Expected: `OK .claude/skills/code-review-guideline/SKILL.md`. A typo here fails
silently at review time — the reviewer just won't find the file.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/claude-review.yaml
git commit -m "ci: load the code-review-guideline skill in the advisory reviewer (#79)"
```

---

### Task 5: Verify against the issue and hand off

**Files:**
- None modified. This task produces evidence.

**Interfaces:**
- Consumes: all four preceding tasks.
- Produces: the verification output quoted in the PR.

- [ ] **Step 1: Run the suite**

Run:

```bash
make db-up && make test && go vet ./...
```

Expected: tests pass, `go vet` silent. The change is docs/config only, so a
failure here means something unrelated broke — investigate before proceeding,
do not hand-wave it.

Capture the actual output. A claim without output is not verification.

- [ ] **Step 2: Check every acceptance criterion of #79**

Run:

```bash
gh issue view 79 --repo Ayut0/tally-up
```

Walk the acceptance-criteria list and confirm each, in order:

```bash
ls .claude/skills/code-review-guideline/SKILL.md                       # exists
grep -in 'mapping.md\|make sqlc\|docs/adr' REVIEW.md || echo "no dup"  # no lens dup
grep -c 'make test\|make db-up\|go vet' .claude/skills/code-review-guideline/SKILL.md  # 0
grep -n 'Self-review' AGENTS.md                                        # no "(no skill)"
grep -rin 'axross\|claude-loop' .claude/skills REVIEW.md AGENTS.md docs/superpowers/specs/2026-07-25-code-review-skill-design.md || echo "no external refs"
```

The last criterion — CI actually loads the skill — cannot be checked locally.
It is Step 4.

- [ ] **Step 3: Self-review the diff using the skill just written**

Run: `git diff origin/main...HEAD`

Read it under `.claude/skills/code-review-guideline/SKILL.md`. This is the
first real exercise of the methodology; if a section is unusable in practice,
fix it now — that is a finding about the skill, not an inconvenience.

- [ ] **Step 4: Push and trigger the CI reviewer**

```bash
git push origin feat/issue-79-code-review-skill
gh pr ready 81 --repo Ayut0/tally-up
gh pr comment 81 --repo Ayut0/tally-up --body '@claude review'
```

Then watch the run:

```bash
gh run list --repo Ayut0/tally-up --workflow claude-review.yaml --limit 3
```

**Expected, and the one that matters:** the posted review uses **Important** /
**Nit** and opens with a tally line.

**Known limitation, state it rather than paper over it:** `issue_comment`
workflows run from the version of the workflow on the **default branch**. This
branch's edit to `claude-review.yaml` is therefore *not* live until merge, so
this run exercises the pre-existing prompt. It proves the trigger path and the
label conventions; it does **not** prove Task 4's clause works. That clause is
only provable on the first `@claude review` after merge — say so in the PR
rather than claiming Task 4 verified.

- [ ] **Step 5: Report on the PR**

Post a comment covering: what changed, the Step 1 output, which acceptance
criteria are confirmed versus deferred to post-merge, and the Task 4 limitation
above stated plainly.
