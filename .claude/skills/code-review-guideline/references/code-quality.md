# Code quality

Language-level checks that apply regardless of which DDD layer the diff
touches. Apply these alongside, not instead of, [`SKILL.md`](../SKILL.md)'s
DDD-boundaries and sqlc lenses. Severity tiers are the ones defined in
[`SKILL.md`'s severity ladder](../SKILL.md#severity-ladder) — this file does
not introduce a parallel vocabulary.

## Magic Values

A bare literal with no name attached forces the reader to reverse-engineer
what it means and makes every call site a place the value could silently
drift.

- SHOULD flag a numeric or string literal in changed code with no obvious
  meaning that isn't bound to a named constant — Minor.
- MUST flag a magic value that participates in amount handling or auth —
  Critical, matching the existing ladder's treatment of amount handling
  (`SKILL.md`'s severity ladder, Critical row).

## Dead Code

Commented-out code cannot be run or type-checked and only rots; an unused
import or a symbol nothing calls is weight the reader carries for no reason.

- MUST flag commented-out code introduced by the diff — Minor. Remove it;
  version control already preserves it.
- SHOULD flag an unused import in a changed file — Nit. `go vet` catches
  this too, but call it out so it doesn't slip past review first.
- MUST flag an exported symbol added in the diff with zero callers in the
  diff or the existing codebase — Minor. Either remove the export or add the
  caller in the same change.

## Comments and Doc-Comments

This repo's convention (see e.g. `internal/domain/ledger/split.go`,
`internal/domain/group/group.go`) is that every exported type, func, and
sentinel error carries a doc comment starting with the identifier's own name,
and each package's first file opens with a `// Package <name> ...` comment.

- MUST flag a new or changed exported symbol whose doc comment is missing or
  doesn't start with the symbol's name — Minor; Major when the symbol is
  part of a package's external entry point (e.g. an application service like
  `AddEntry`, not an unexported helper).
- SHOULD flag a line comment that only restates the code it precedes — Nit.

## Type Reuse

An inline shape repeated across the diff has to be edited in every copy when
it changes, where a single named type documents the concept once.

- SHOULD flag an inline struct shape repeated more than once in the diff —
  Minor. Extract a named type.

## Control Flow

Deep nesting forces the reader to hold every branch condition at once; early
returns let each case be dismissed on its own.

- SHOULD flag a deeply nested `if`/`else` chain flattenable with early
  returns — Minor. Applies in TS as much as Go: `if (cond) { if (other) {
  ... } }` should split into sibling guard clauses (`if (cond && other)
  {...}` then `if (cond) {...}`), not just Go's early-return idiom.
- SHOULD flag a `switch` over a sentinel-style value (e.g. an entry kind)
  with no `default` case — Minor. The compiler won't catch a new case being
  silently unhandled.

## File Naming

A file that breaks the surrounding package's naming pattern is harder to
locate and makes the reader second-guess what kind of file it is.

- MUST flag a new `.go` file whose name doesn't match its package's existing
  pattern — lowercase, underscore-separated for multi-word names (e.g.
  `entry_repository.go`, not `entryRepository.go` or `EntryRepository.go`) —
  Minor.

## Identifier Naming

A symbol named unlike its neighbors makes the reader stop to check whether
the difference carries meaning.

- SHOULD flag package-name stutter (e.g. `ledger.LedgerPosting` instead of
  `ledger.Posting`) — Minor.
- SHOULD flag a receiver name that's inconsistent across methods of the same
  type — Minor.
- MUST flag a new sentinel error that doesn't follow this repo's `ErrXxx`
  convention (lowercase message, no trailing punctuation — see
  `internal/domain/entry/entry.go`) — Minor.
- SHOULD flag opaque abbreviations in new identifiers (`amt` for "amount",
  `mem` for "member") — Nit.

## TypeScript

Rules with no Go analogue, for `web/`'s TS/React code. Everything else in
this file already applies language-agnostically; this section only exists
for the handful of concerns that don't map onto Go's type system.

- SHOULD flag an `as T` type assertion on a value crossing an untyped
  boundary (a `fetch`/`Response.json()` result, a mock call's captured
  args, `JSON.parse` output) with no runtime check behind it — Minor. An
  assertion is a claim the compiler doesn't verify; prefer a schema parse
  (`schema.safeParse(...)`) or an explicit narrow (`typeof`/`instanceof`,
  or a helper like `new Headers(init?.headers).get(name)`) that fails
  loudly instead of trusting the shape.
- MUST flag that same kind of assertion — Major — when the asserted value
  feeds amount/ledger or auth logic, matching the ladder's amount-handling
  escalation.
- MUST NOT flag a const assertion (`"settlement" as const`) under either
  rule above — it narrows a literal's type to prevent widening, it does not
  assert unchecked trust in untyped data.
- SHOULD flag `x === undefined` / `x !== undefined` narrowing where
  `typeof x === "..."` would read as the more direct check — Nit. Style
  preference in this codebase's TS, not a correctness difference.

## YAGNI

An abstraction introduced before a second caller exists guesses at a shape
the future may never need.

- MUST flag a new abstraction (helper function, interface, parameter) that
  has exactly one caller in the diff and no documented future caller — Minor.
  Inline it.

## DRY (Done Right)

Genuine duplicates of the same concern drift apart the moment one copy is
updated and the others are forgotten — but coupling two blocks that only
coincidentally look alike is worse than the duplication.

- SHOULD flag two or more blocks in the diff that are near-identical
  duplicates of the *same* concern — Minor. Prefer "rule of three": treat
  duplication as a smell after the third occurrence, not the second.
- MUST NOT recommend extracting a helper when two blocks are only
  coincidentally similar but represent different concerns.

## KISS

Code is read far more often than written; a line that takes ten seconds to
decode taxes every future reader.

- SHOULD flag a one-liner that takes more than ten seconds to parse when a
  named-steps version would read more clearly — Minor.
- SHOULD flag a generic type parameter on a function with exactly one
  concrete usage in the diff — Minor. Replace with the concrete type.

## Diff Size

The more unrelated ground a single diff covers, the more likely a real
defect slips past the reviewer unnoticed.

- SHOULD flag a diff touching more than ~15 unrelated files or ~600 net
  lines as Minor "consider splitting". Defer the actual split decision to
  the human, per [AGENTS.md § Escalation](../../../../AGENTS.md#escalation).

## Not ported

TS-specific coverage now exists — § TypeScript (type assertions, `typeof`
narrowing) and § Control Flow (nested-if, generalized to cover TS too) —
per issue #117. What's still deliberately out of scope, dispositioned in
issue #83:

- **Lint Complexity Thresholds** (cognitive complexity / function length /
  unsafe-type-escape severities read off a linter config) — tally-up has no
  configured linter (`make test` + `go vet` is the whole verify surface).
  Revisit as a follow-up issue if enforced complexity budgets are wanted.
- Six sections with no Go analogue: Server/Client Boundary, Data-Layer
  Hooks/UI Boundary, Domain Pipeline Boundary, Route File Layout, Directory
  Tier, SOLID Applied to Component Trees — all specific to a
  TypeScript/React/Next.js frontend this repo doesn't have.
- Three sections that would duplicate rules already in `SKILL.md`:
  Data-Access/UI Split and Cross-Tier Imports (→ § DDD boundaries),
  In-Scope vs Out-of-Scope (→ § Scoping the diff).
