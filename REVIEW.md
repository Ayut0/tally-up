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
