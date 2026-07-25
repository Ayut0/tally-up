# 3. TypeSpec as the HTTP API contract source of truth, validated (not generated) on the Go side

- **Status:** Accepted
- **Date:** 2026-07-26
- **Deciders:** Yuto
- **Related:** Issue #93 (this decision); `spec/main.tsp`, `spec/openapi.yaml`;
  `internal/interfaces/rest/openapi_spec_test.go`;
  `.github/workflows/spec-drift.yaml`; `web/lib/api-types.ts`

## Context

`web/` (issue #6) is a second consumer of the HTTP API alongside its Go server,
and features that touch both sides — the common case going forward — need an
interface agreement settled before either side can build against it. That
agreement previously existed only as a conversation, unenforced by anything.

The concrete failure mode this produced already existed in the code before
this decision: `ledger.SplitRule` (`internal/domain/ledger/ledger.go`) is a
flat struct — `{Type, Amounts, Weights}` — so `{"type":"shares","amounts":{...}}`
parsed without error and only failed later, at runtime, inside
`ledger.ComputePostings`'s `coversExactly` check. A hand-maintained OpenAPI
document would have been exposed to the same ambiguity; nothing forces it to
match the domain type it describes.

`interfaces/rest` also encoded domain reads straight to the wire —
`entry.BalanceSnapshot` and a `map[string]any{"entries": ...}` — despite its
own doc comment stating its job is to "decode, build a command, call the
application service, translate the result." There was no artifact whose
job was specifically to say what the wire contract *is*, independent of
whatever the domain layer happened to serialize to on a given day.

## Decision

### TypeSpec compiles to a committed OpenAPI document; that document is the contract

`spec/` is a self-contained npm project (mirrors `web/`): `spec/main.tsp` is
hand-written, `spec/openapi.yaml` is generated via `make spec`
(`tsp compile .`) and committed. Both source and output are checked in so a
reviewer sees the same document a generator would produce, and so a client
work can be pointed at `openapi.yaml` without installing the TypeSpec
toolchain.

### OpenAPI 3.0, not 3.1

`@typespec/openapi3` emits `Record<T>` — used by `SplitRule`'s
`amounts`/`weights`, the exact fields the discriminated union exists to
protect — as `unevaluatedProperties` under OpenAPI 3.1. `openapi-typescript`
does not recognize that JSON Schema 2020-12 keyword and silently types the
map's values as `never`, making `weights`/`amounts` uncomposable in the
generated TypeScript client — a compile-time dead end, strictly worse than
the runtime 422 the ambiguous flat struct produced before this work. 3.0's
`additionalProperties` is read correctly by both `openapi-typescript` and
`kin-openapi`. Revisit if `openapi-typescript` gains `unevaluatedProperties`
support.

### Go validates the contract; it does not generate from it

Handlers, request/response types, and routing in `internal/interfaces/rest`
are hand-written, same as before this issue. A test-only middleware
(`openapi_spec_test.go`) wraps the test server's handler and checks every
request and response any handler test exercises against `spec/openapi.yaml`
via `kin-openapi`, so contract drift fails a Go test instead of surfacing as
a client bug.

Generating the Go server from the spec (`oapi-codegen` or similar) was
available and rejected for this codebase specifically: `addentry.Result.Body
[]byte` is a byte-identical snapshot returned verbatim on idempotency replay
(`internal/application/addentry/addentry.go`), which fights the typed return
signatures a generated strict-mode server expects. Validating costs nothing
in that direction; generating would mean restructuring the write path first,
for a benefit (compile-time request/response types in Go) that the domain
layer already provides at the boundaries that matter — see `interfaces/rest`
now owning named, hand-written DTOs that explicitly translate to/from domain
types (`reads.go`, `entries.go`) rather than encoding domain values directly.

### The web client generates from the contract

`web/` runs `openapi-typescript` against `spec/openapi.yaml`
(`npm run gen:api-types`) and commits the output
(`web/lib/api-types.ts`). Because that file carries no runtime code — it's
pure type declarations — a contract regression can only be caught at compile
time; `web/package.json`'s `test` script runs `tsc --noEmit` before `vitest
run` specifically so `web/lib/api-types.test.ts`'s typed object-literal
assignments gate the suite instead of being silently stripped by vitest's
esbuild transform.

### CI fails on spec drift, independently of Go CI

`.github/workflows/spec-drift.yaml` rebuilds `spec/openapi.yaml` from
`spec/main.tsp` on any PR or `main` push touching `spec/**` and fails if the
result differs from what's committed. It is deliberately narrow — Node
only, no Postgres or Go toolchain — and stays a separate workflow from
`.github/workflows/ci.yaml` (issue #94, merged as #95, while this work was
in progress): `ci.yaml` builds, vets, and runs the Go tests that need no
database; it never touches the TypeSpec/Node toolchain, so a spec change
with no Go change wouldn't trigger it. Note that neither workflow gates a
merge yet — `ci.yaml`'s own header records that branch protection hasn't
been turned on for it — so both currently report rather than block.

### The contract is frozen before implementation changes it

Once `spec/main.tsp` describes an endpoint, changing what it promises is a
deliberate, committed act — edit the `.tsp`, regenerate, both the Go and web
sides pick up the new contract explicitly. The failure mode this guards
against: editing `.tsp` reactively whenever the Go handler hits friction,
which would mean paying the toolchain cost while losing the actual benefit
(the web side building against a contract that quietly moved under it).

## Consequences

**Positive**

- Four real bugs surfaced by writing and wiring the spec, all before any
  client existed to hit them: write endpoints returning a small ack
  (`{id, seq, ...}`) rather than the full entry the first draft assumed;
  `reverses_id`/`reversal_id` naming one character apart while meaning
  opposite things; `CreateEntryRequest` requiring `split_rule`/`participants`
  unconditionally when `addentry.ComputePostings` never reads either for a
  settlement; and the OpenAPI 3.1/`unevaluatedProperties` incompatibility
  above.
- `SplitRule` and `CreateEntryRequest` as kind-discriminated unions give the
  generated TypeScript client a guarantee Go's own type system cannot
  express: a settlement carrying a split rule, or an expense missing one, is
  a compile error on the client, not a 422 discovered at request time.
- `interfaces/rest` now has an explicit translation boundary
  (`newBalanceResponse`, `newEntryResponse`, `splitRuleRequest.toDomain()`)
  instead of encoding domain values straight through — a domain field rename
  now fails a compile instead of silently changing the wire contract.
- The mock-server workflow this was chosen for (build the web client against
  the spec before the Go side exists) is available starting with the next
  new endpoint (issue #86).

**Negative / accepted trade-offs**

- Two-stage trust on the Go side: hand-written request/response DTOs still
  have to be kept in sync with `spec/main.tsp` by a person or agent: the
  `kin-openapi` test catches drift only for the handler paths its tests
  actually exercise, not by construction.
- A second toolchain (Node, in `spec/`) alongside Go, on top of the one
  `web/` already needs.
- Pinned to OpenAPI 3.0 until `openapi-typescript` (or whichever consumer
  gains ground) supports `unevaluatedProperties`; some newer JSON Schema
  2020-12 modeling is unavailable until then.
- Discriminated unions and the `Created<T>`/`Replayed<T>` response templates
  add real verbosity to `main.tsp` relative to one flat shape per endpoint —
  paid deliberately, in exchange for the compile-time guarantees above.

## Alternatives considered

- **Go-first (e.g. Huma), deriving OpenAPI from Go handler signatures.**
  Rejected — puts the Go backend in sole authority over the contract, which
  defeats the actual reason for adopting a contract at all: letting the web
  client build and test against an agreed shape before the Go side exists.
  Also does not cleanly model a discriminated union the way TypeSpec's
  `@discriminated` does.
- **Generate the Go server from the spec** (`oapi-codegen`, `ogen`, strict
  mode). Rejected for the reason under "Go validates... it does not
  generate" above: the idempotency replay path's `[]byte` snapshot fights
  generated strict-mode return signatures, and validating gets the same
  drift protection without restructuring the write path.
- **No schema-first tooling; keep hand-writing both sides.** Rejected — this
  was the status quo that let the `SplitRule` ambiguity and the
  `reverses_id`/`reversal_id` naming collision exist undetected, and gives
  the web client nothing to build against before Go handlers exist.
