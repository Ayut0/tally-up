# 6. A Gherkin E2E tier runs against the real stack, in its own CI job

- **Status:** Accepted
- **Date:** 2026-08-28
- **Deciders:** Yuto
- **Related:** ADR 0005 (Storybook interaction tests — the tier this sits
  directly above, and whose scope argument this reuses); Issue #138 (the
  "`web/` suite never renders JSX" rule); Issue #268 (`GET /healthz`, which
  this uses as the API's readiness probe)

## Context

`web/` has two test tiers today and neither can see a whole-system failure.

The vitest logic suite (#138) never renders JSX: pure rules go to `lib/`,
stateful ones to a colocated hook driven by `renderHook`. It verifies decided
values, not wiring. Storybook interaction tests (ADR 0005) render components
and click through them, but every network call they make is MSW-mocked — the
handler is written by the same person writing the component, from the same
mental model. If the Go API renames a field, changes a status code, or the
client's zod schema drifts from `spec/openapi.yaml`, **both tiers stay green.**
`make web-api-check` catches generated-client staleness, but not a client and
server that disagree about behavior at runtime.

There is also no test anywhere that exercises a user's actual path through the
product — create a group, add an expense, read a balance — across the browser,
the API, and Postgres together. The Go suite covers the write path and the
ledger invariants thoroughly, from `POST /groups/{id}/entries` inward. Nothing
covers the browser-to-Postgres round trip.

Separately, the repo's plan/implement/verify cycle (AGENTS.md) asks for
behavior to be pinned in something executable. Gherkin is a good fit for the
outermost tier specifically because this domain has a real, documented
vocabulary (`docs/architecture.md`: ledger, entry, posting, split, balance) —
a scenario written in those words is a readable statement of intent, not a
second copy of the code.

## Decision

Adopt **playwright-bdd** on the Playwright runner as a third test tier, in
`web/e2e/`, running against the real stack with nothing mocked.

- **Real stack, not mocks.** Playwright's `webServer` boots `go run ./cmd/api`
  and the Next.js client itself, waiting on `/healthz` (#268) for the API. A
  mocked-API variant was rejected: it would duplicate what ADR 0005's tier
  already does, and would specifically not catch the contract drift that
  motivates this tier at all. Postgres is the one dependency Playwright does
  not start — `make e2e` depends on `db-up`, so a container's lifetime isn't
  tied to a single run.

- **Lives in `web/e2e/`, not a root `e2e/` package.** It reuses `web/`'s npm
  project, tsconfig, and lockfile rather than adding a third one (after
  `spec/` and `web/`). The cost is a naming imprecision — a directory under
  `web/` boots the Go API — which this ADR is the answer to.

- **Three layers, enforced by convention:** `features/` (Gherkin, domain
  vocabulary only) → `steps/` (translation, no locators) → `screens/` (page
  objects, the only layer touching the DOM). The point is that a screen
  redesign changes one file and never a `.feature`. `web/e2e/README.md` is the
  contributor-facing explanation.

- **Accessible selectors, no `data-testid`.** Screens locate by role, label,
  and text. Where the app offered no accessible name — `BalanceList` and
  `HistoryList` are both `<ul>`s captioned by a styled `<p>`, since
  `Text variant="label"` renders a `Paragraph`, not a `Heading` — the fix went
  into the app as `aria-label` on the `<section>`, making each a named region.
  That is a real improvement for assistive tech, which a test ID would not
  have been.

- **`fullyParallel`, no cleanup.** Each scenario creates its own group through
  the UI, so it owns a fresh uuid and shares no rows. This is the one suite in
  the repo that does *not* need `-p 1`, precisely because it never truncates.

- **Its own CI job (`e2e`), advisory at first.** It needs Go, Postgres, and
  Node together — a combination neither existing job has — so folding it into
  `web` would mean installing a Go toolchain and a database into a job that
  wants neither. It starts non-blocking, matching how `storybook build` (#184)
  and `test:storybook` (ADR 0005) both entered, and not preempting #96's open
  decision about which checks become required.

- **One proving scenario to start.** An equal three-way split, asserting the
  rendered signed balances. It plays the same role `BalanceList` played for
  #184 and `RemoveBlockedByNonzeroBalance` played for ADR 0005: one real case
  that proves the rig works, rather than a broad suite landing untested.

## Consequences

**Positive**

- Client/server contract drift becomes visible. This is the failure class no
  other tier in the repo can see, mocked or generated-type-checked.
- The user's actual path through the product is exercised once, for real,
  including the pieces no unit test covers: routing, `localStorage` identity,
  the idempotency headers, JSON round-tripping, CORS.
- Scenarios double as documentation in the domain's own vocabulary, and unlike
  prose they fail when they stop being true.
- Verified negatively before landing: with the expected balance changed to a
  wrong value the scenario fails, so the assertion is real rather than
  vacuously passing.

**Negative / accepted trade-offs**

- The slowest tier by far: ~25s wall-clock for one scenario locally, most of
  it booting `go run` and Next.js. It will never be the inner-loop suite, and
  shouldn't grow to cover cases a lower tier could hold.
- A third CI job, with a Postgres service container and a Go toolchain
  duplicated from the `test` job.
- E2E tests are the classic home of flakiness. Mitigations taken: no fixed
  sleeps anywhere (every wait is an auto-retrying `expect` or a `waitForURL`),
  one CI retry, and traces/screenshots retained on failure. If flakiness
  appears anyway, the answer is to push the case down a tier, not to add waits.
- Running `make test` and `make e2e` against the same local database
  concurrently will break the E2E run — the Go helper truncates shared tables.
  CI gives them separate containers; locally it's a documented caveat.

## Alternatives considered

- **Cucumber-JS with Playwright as a library.** Rejected: gives up the
  Playwright runner's fixtures, parallelism, tracing, and HTML report —
  precisely the machinery that makes an E2E tier debuggable.
- **Plain Playwright specs, no Gherkin.** Genuinely viable, and lighter. Chosen
  against because the domain vocabulary is the thing worth pinning at this
  altitude; the Gherkin layer is what keeps the outermost tests from decaying
  into selector scripts.
- **Root-level `e2e/` npm project.** More honest naming for something that
  tests the whole system, and `spec/` is precedent for a third package.
  Rejected for now on cost: another `package.json`, lockfile, and browser
  install for one scenario. Revisit if the suite grows its own tooling needs.
- **Fold E2E into the existing `web` CI job.** Rejected: that job would need
  Go and a Postgres service purely for one step, and its runtime would roughly
  double for every PR that touches only web code.
