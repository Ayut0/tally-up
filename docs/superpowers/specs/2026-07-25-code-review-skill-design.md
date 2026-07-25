# In-repo code-review skill — design

- **Issue:** [#79](https://github.com/Ayut0/tally-up/issues/79)
- **Date:** 2026-07-25
- **Status:** approved, pending implementation

## Problem

`AGENTS.md` defines the cycle `plan → implement → self-review → verify → report`
and marks **self-review** as *(no skill)*. The rigor of a self-review therefore
depends on the agent's mood, while the CI reviewer — the *same diff*, reviewed a
second time — has a written policy in `REVIEW.md`. Two reviewers, two bars.

`REVIEW.md` also conflates two concerns:

- policy about the **posted artifact** (advisory, never gates, don't re-litigate
  `gofmt`/`go vet`);
- **review lenses** (DDD boundaries, sqlc, escalation triggers, verification).

The lenses are not posted-review-specific. They apply just as much to a local
self-review, but a local self-review has no reason to read `REVIEW.md` — a file
whose stated purpose is "instructions for the independent CI reviewer". The
useful half of the policy is trapped in the wrong file.

The shape of the fix comes from
[axross/claude-loop-template `code-review-guideline`](https://github.com/axross/claude-loop-template/tree/main/.claude/skills/code-review-guideline),
which already anticipates a repo-root `REVIEW.md` and defines a "Repository
Review Policy Overlay" for precisely this split.

## Decision

Add an **in-repo, non-invocable** skill holding the review methodology, serving
both reviewers; slim `REVIEW.md` to the posted-review policy that genuinely
differs.

The dividing rule, applied to every line moved:

> If it is true whether or not anyone else sees the review, it belongs in the
> skill. If it is about the posted artifact, it belongs in `REVIEW.md`.

Decisions locked during brainstorming:

| Dimension | Choice | Rationale |
| --- | --- | --- |
| Consumers | **Both** local self-review and CI | One methodology; otherwise the two reviewers drift apart in rigor, which is the problem being fixed. |
| Location | **In-repo** `.claude/skills/code-review-guideline/` | The workflow's base-ref checkout (SAFETY 2) is what puts the file on the runner. A `~/.claude` skill is invisible to CI. |
| Structure | **Single `SKILL.md`** | Splitting into `references/` is progressive disclosure for a skill large enough to pay for it. Split later, per section, when one actually grows. |
| Lenses | Written for **this repo** | The reference's lens table points at frontend skills (e2e, components, routing) tally-up does not have. A table of dangling references is worse than no table. |
| Invocation | **No slash command** | Methodology loaded when reviewing, not a command. Also avoids colliding with the existing `/code-review` plugin command CI already runs. |
| `REVIEW.md` | **Slimmed** to posted policy | Removes duplication; each rule gets exactly one home. |
| CI wiring | **In this change** | Otherwise "serves both consumers" is only half true and unverified. |
| Relation to #77 | **Independent** | #77 is trigger *timing*; this is review *method*. Neither blocks the other. |

## Components

### 1. `.claude/skills/code-review-guideline/SKILL.md` (new)

Frontmatter uses **Claude Code fields only** — `name` and `description`. The
reference's `when_to_use:` and `user-invocable:` are claude-loop conventions;
`when_to_use` folds into `description` (the field Claude Code actually matches
on), and omitting a slash command is what makes a skill non-invocable.

Sections:

| Section | Carries |
| --- | --- |
| Reviewer-mode reset | Stop editing → reread the issue → read the diff **before** the surrounding files → judge as if another author wrote it. Fixing an Important finding requires a **second pass**. |
| Scoping | `git status`; `git diff origin/main...HEAD` (three-dot — this repo rebases, never merges, so two-dot would mis-scope); `gh pr diff`. Untracked files count. Pre-existing problems are reported *separately*, never mixed into diff findings. |
| Severity ladder | Four internal tiers with tally-up examples (below). |
| Evidence | Every finding cites `file:line`, states what's wrong, why it matters, and the smallest fix as a `-`/`+` snippet. No location, no finding. |
| Verification | Report the **actual output** of `make db-up` → `make test` → `go vet ./...`, or name what was skipped and why. Cites `docs/development.md` rather than restating commands. |
| tally-up lenses | DDD boundaries per `docs/mapping.md`; sqlc (never hand-edit generated code — `query/*.sql` + `make sqlc`); migrations / data loss / auth → ADR in `docs/adr/`; one issue per branch. |
| Posted-review overlay | When the output is a posted PR review, `REVIEW.md` wins: collapse to its labels, no verdict, COMMENT-type only. |
| Escalation | Review is **report-only** — do not mutate code mid-review. `Decision needed:` entries for caller decisions; `Guideline gap:` notes for recurring misses. |

Severity ladder, grounded in this repo:

- **Critical** — ledger correctness (double-entry not balancing, amount
  handling), data loss in a migration, auth bypass, hand-edits to
  sqlc-generated code.
- **Major** — a dependency pointing the wrong way across a DDD layer; domain
  logic in `interfaces/rest` or `infrastructure/postgres`; missing ADR on an
  escalation trigger; new runtime behavior with no test.
- **Minor** — unclear naming that survives review; unwrapped error context; a
  non-table-driven test where its siblings are table-driven.
- **Nit** — typos, ordering.

For **self**-review the mapping is blunt: any Critical or Major → fix, then
re-review. The Approve / Request Changes verdict vocabulary is internal only and
never appears in posted output.

### 2. `REVIEW.md` (slimmed, ~35 lines)

Keeps, because each is about the posted artifact:

- advisory stance; never gates merges;
- **label set: Important / Nit**;
- do-not-report list: `gofmt`, `go vet`, generated files, lockfiles;
- never `APPROVE` / `REQUEST_CHANGES` — COMMENT-type only;
- an unmet or unverifiable acceptance criterion of the linked issue is Important;
- out of scope: running the build or test suite.

Loses the `## What to weigh` lens block, which moves into the skill and is cited
by link.

**The label set is an addition, not a move.** Today `REVIEW.md` says "prefer a
few high-confidence findings" and defines no vocabulary at all. Important / Nit
is the axross overlay's assumption; adopting it is a deliberate new decision
recorded here.

### 3. `AGENTS.md` (edit)

- Cycle step 3 stops saying *(no skill)* and routes to the new skill.
- The skill-routing table's single
  `Self-reviewing or verifying | *(no skill — see The cycle)*` row **splits in
  two**: self-review routes to `code-review-guideline`; verify keeps an inline
  pointer to the [Verify](#verify) section, since it remains skill-less.

### 4. `.github/workflows/claude-review.yaml` (edit)

One clause added to `--append-system-prompt`: read
`.claude/skills/code-review-guideline/SKILL.md` as the review methodology, with
`REVIEW.md` winning on conflict. Precedence becomes **`REVIEW.md` → skill →
plugin defaults**.

No structural change: the trigger, the three safety properties, the tool
allow/deny lists, and the permission set are all untouched. This works only
because SAFETY 2's base-ref checkout already places the skill file on the runner.

## Verification

- `make db-up` && `make test` && `go vet ./...` — the change is docs/config only,
  so these must be unaffected; the claim still needs output.
- YAML validity of the workflow edit.
- **The real proof:** open the PR, comment `@claude review`, and confirm the run
  posts findings using the Important / Nit labels and cites the skill's lenses.
  Until that run posts, "CI loads the skill" is a hypothesis.

## Non-goals

- **Does not close [#77](https://github.com/Ayut0/tally-up/issues/77).** That
  issue is about the advisory review not auto-dispatching on PR open — trigger
  timing, not review method. It stands alone.
- No new slash command.
- No `references/` split; revisit per-section if one outgrows the file.

## Risks

| Risk | Mitigation |
| --- | --- |
| The CI job runs the official `code-review` plugin, whose own methodology may conflict with the skill. | Explicit precedence in the system prompt: `REVIEW.md` → skill → plugin defaults. |
| Slimming `REVIEW.md` touches a CI-load-bearing file. | The workflow references it only by path; content changes cannot break the trigger. Verified by the `@claude review` run on the PR. |
| Skill and `REVIEW.md` re-accumulate duplication over time. | The dividing rule is stated at the top of both files, so the next editor has a test to apply. |

## Related

- [#77](https://github.com/Ayut0/tally-up/issues/77) — advisory review
  auto-dispatch (independent).
- [#78](https://github.com/Ayut0/tally-up/issues/78) — requirement-level keywords
  in `AGENTS.md`. The skill is written in MUST/SHOULD, so the two should land
  coherently.
- [#76](https://github.com/Ayut0/tally-up/issues/76) — the `/address`
  orchestrator, whose self-review step would route to this skill.
