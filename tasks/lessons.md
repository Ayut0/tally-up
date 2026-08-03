# Lessons

## 2026-07-05 — Goal scope governs phase transitions

**What happened:** The session goal was "Do a planning and refining them." After
finishing the Phase 1–2 plan, the writing-plans skill's handoff offered execution
options; execution started and the user had to pull it back to planning.

**Rule:** When a session goal is set, filter every next step through it. A skill's
built-in handoff ("plan is done, want me to execute?") does not override the goal —
if the goal says *plan*, the handoff should offer *more planning* (next phases,
refinement passes), and moving to implementation needs the user to explicitly widen
the goal first. Completing an artifact is not permission to change phases.

## 2026-07-25 — File follow-ups as issues when you identify them, not as prose

**What happened:** Writing issue #94, I listed three deferred items (web CI, sqlc
drift check, golangci-lint) in an "Out of scope — file as follow-ups" section and
moved on. The user later asked "Did you create a follow up issue for it?" — I had
not. The items existed only as prose inside another issue, so they would have
vanished from the tracker the moment #94 closed.

**Rule:** "File as a follow-up" is an action, not a label. When a task surfaces
deferred work, create the issue in the same turn you identify it. Naming something
out-of-scope inside another issue's body does not track it — a reader of the issue
list will never see it. If filing needs the user's call, ask then, not later.

## 2026-07-25 — Answer the question asked; don't reformulate it into options

**What happened:** The user asked plainly "so what do you want me to write?" after
I had already offered a multi-option AskUserQuestion about the same decision. The
question tool was rejected. They wanted the concrete ask, not another menu.

**Rule:** AskUserQuestion is for decisions where the answer changes what I do next
and I genuinely cannot pick. When the user asks a direct question — especially a
"what exactly do you need from me" question — answer it in prose with the specific
file, line, and contract. Repeated option menus on a decision already under
discussion read as stalling.

## 2026-07-25 — Justify test-only code in production files, or move it

**What happened:** I added a type, constants, a `String()` method, and a helper to
`store.go` — all test-only. The user pushed back: "Why do we have to modify our
code just for test?" The core of it was defensible (`TestStore` must be in a
non-test file because another package's tests call it, and non-test files cannot
reference `_test.go` symbols), but `String()` was not — it moved to `store_test.go`
with no loss.

**Rule:** Before putting test-support code in a non-test file, check each symbol
individually against the actual constraint. Methods on a package type *can* live in
that package's `_test.go`. Ship the minimum the constraint forces, say in the diff
why that minimum is forced, and file the structural fix (a `postgrestest` package)
rather than letting it accrete silently.

## 2026-07-25 — A platform-specific workaround must be scoped to its platform

**What happened:** The Makefile set `CGO_ENABLED=0` unconditionally, commented as a
macOS dyld workaround "harmless elsewhere". It was not harmless: on Linux
`go test -race` requires cgo, so the first CI run failed. I had flagged the risk in
the plan but proposed papering over it at the call site (`make test GO=go`).

**Rule:** When a comment says a workaround exists for platform X, scope it to
platform X (`ifeq ($(shell uname -s),Darwin)`) rather than making every caller pass
an override. "Harmless elsewhere" in a comment is a hypothesis, not a finding —
treat it as unverified until something actually runs elsewhere.

## 2026-07-25 — A technically-correct correction can still miss the point

**What happened:** The user said "I don't have a DB available at this point except
local one. We can create a follow up issue and circle back." I answered that CI
provisions its own throwaway Postgres, so no database was needed on their side —
true, and it dissolved the stated *reason*. They picked "proceed as scoped" from
the options I offered. Two rounds of work later they said it again: "We don't have
to run test against our store at this moment as I said." The scope then had to be
unwound — service container removed, guard re-keyed from `CI` to an explicit
opt-in, PR body rewritten, a new follow-up issue filed.

**Rule:** When someone gives a constraint plus a reason, refuting the reason does
not dispose of the constraint. Answer the factual point, then ask what they want
to happen — do not treat "your stated reason doesn't apply" as "therefore we
proceed my way." The phrase "as I said" is the tell that a preference was
overridden rather than heard, and by then the rework is already paid for.
Offering a menu whose recommended option is my position is not the same as asking.

## 2026-08-03 — A green local suite on a stale base says nothing about the merge

**What happened:** I branched from `origin/main` for #123, and #159 merged five
minutes later, adding a **required** `requested_by` to `EntryRequestCommon`. My
worktree stayed green all the way through — tests, lint, typecheck, `next build`,
and a full browser run — because `tsc` was checking against the `api-types.ts`
that shipped with my stale base. CI, which builds the *merge* ref, failed on the
first push. The advisory reviewer independently found the same defect and named
the same fix.

**Rule:** Local verification proves the branch compiles against the base it was
cut from, not against what will land. Before calling a branch verified, check
whether `main` moved: `git fetch && git merge-base --is-ancestor origin/main HEAD`.
If it has, verify against the merge result rather than the branch.

When rebasing is off the table (pushed branch, and
[[feedback-ask-before-history-rewrite]] means the maintainer decides), the
merge result is still reachable without touching history:

```sh
git worktree add --detach /tmp/mergecheck origin/main
cd /tmp/mergecheck && git merge --no-ff --no-commit <branch>
```

That reproduces CI's merge ref exactly. Run the suite there — and if the change
spans client and server, boot the server from that worktree too, so a new
server-side requirement is *enforced* rather than assumed. Report those numbers
explicitly as merge-result numbers; a PR body carrying pre-fix counts is a
verification claim that has quietly gone stale, which the reviewer will (rightly)
call out.

**Corollary:** stale numbers in a PR body are their own defect. When a fix commit
lands after the body was written, update the body — do not leave the reader to
reconcile "49 passed" with a later comment saying 50.
