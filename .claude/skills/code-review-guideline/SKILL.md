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

- [`AGENTS.md`](../../../AGENTS.md) § Review Independence Gates owns the gate
  itself: Critical and Major findings MUST be fixed before you report. This
  table is what makes that rule usable — it says which findings are which.
- A fixed Critical or Major finding MUST be re-reviewed; the fix is new code
  nobody has reviewed.
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

[`AGENTS.md`](../../../AGENTS.md) § Escalation owns which changes escalate —
currently migrations, data loss, and auth. Flag such a change that carries no
ADR in [`docs/adr/`](../../../docs/adr/).

### Branch hygiene

[`AGENTS.md`](../../../AGENTS.md) § Conventions owns the branch rules. Flag a
diff that breaks them — most often one that mixes work for a second issue.

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
