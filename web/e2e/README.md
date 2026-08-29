# E2E — Gherkin scenarios against the real stack

The third and outermost test tier in this repo. It drives a real Chromium
against a real Next.js client, a real Go API, and a real Postgres, with
nothing mocked. Why it exists alongside the other two tiers, and what belongs
in each, is in [`docs/adr/0006-gherkin-e2e-tier.md`](../../docs/adr/0006-gherkin-e2e-tier.md).

## Running it

```sh
make e2e         # from the repo root — starts Postgres, then runs the suite
make e2e-ui      # same, in Playwright's UI mode (step through a scenario visually)
```

Playwright starts the Go API and the Next.js client itself (`webServer` in
[`playwright.config.ts`](../playwright.config.ts)) and shuts them down after.
The one thing it does not start is Postgres — `make e2e` depends on `db-up`
for that, because a container's lifetime shouldn't be tied to one test run.

If you already have `make run` and `npm run dev` going, the suite reuses them
rather than starting a second copy (`reuseExistingServer`). To point at other
ports instead, set `E2E_API_PORT` / `E2E_WEB_PORT` / `E2E_DATABASE_URL`.

If you ran `npm run build` in this working tree before running the suite
locally, delete `.next/` first. The local run uses `next dev`, and a `.next/`
left in production shape makes the dev server serve 404s for every route —
which surfaces as a step timing out on a page that looks blank. CI is
unaffected: it builds and serves production in one go.

Direct invocation, from `web/`:

```sh
npm run e2e                                  # bddgen && playwright test
npm run e2e -- --headed                      # watch it drive the browser
npm run e2e -- --grep "equal split"          # one scenario
npm run e2e:report                           # open the HTML report after a failure
```

## The three layers

A scenario is deliberately split across three files, each with one job. The
rule that keeps them honest: **each layer may only talk to the one below it.**

```
e2e/features/*.feature   Gherkin, in the domain's language.
        │                No buttons, no routes, no selectors.
        ▼
e2e/steps/*.steps.ts     Translation. Binds a sentence to screen calls.
        │                No selectors of its own.
        ▼
e2e/screens/*.ts         Page objects. The ONLY layer that knows the DOM.
        │
        ▼
        the running app
```

**Features** describe behavior a domain expert would recognise — _"an equal
split leaves the payer owed and the others owing"_. They use the vocabulary
from [`docs/architecture.md`](../../docs/architecture.md) (group, member,
entry, expense, split, balance, posting), never UI nouns. A screen redesign
should never touch a `.feature` file; if it does, the feature was written at
the wrong altitude.

**Steps** are the translation layer, and should stay thin — a few screen calls
each. They hold no locators. When two scenarios need the same sentence, they
share the step; that reuse is the whole point of writing steps rather than
plain Playwright tests.

**Screens** are page objects, one per screen of the app. They own every
locator and every "what does done look like" wait. When HeroUI's Select
changes shape, or the balance row markup moves, exactly one file changes.

Screens reach steps as Playwright fixtures (`e2e/steps/fixtures.ts`), so a
step body reads `await addExpense.submit()` rather than constructing objects.
Every step file must import `test` from `./fixtures` — never from
`playwright-bdd` or `@playwright/test` directly, or it gets a different
fixture set and the screens won't be there.

## `.features-gen/` is generated

`bddgen` (run by the `e2e` script, before `playwright test`) compiles each
`.feature` into a real Playwright spec under `.features-gen/`. That directory
is committed — same rule as `internal/infrastructure/postgres/sqlc/` and
`web/lib/api-types.ts`/`api-schemas/` (decided in #273: commit generated
code, guard it with a `<name>-check` target). `make features-gen-check`
regenerates and diffs against what's committed; run it (or just `npm run e2e`,
which regenerates unconditionally) after editing a `.feature` file, and commit
the result. Never hand-edit it — it is worth reading once, though: it makes
clear that a Gherkin scenario is just a normal Playwright test with a nicer
front end.

Its diffs are close to unreviewable — a single-comment `.feature` edit tends
to change a handful of line-number integers inside one large minified JSON
blob, so GitHub renders one giant red line and one giant green line. That's a
known, accepted cost of one repo-wide rule (#273), not a bug.

## Selectors: accessible roles, not test IDs

Screens locate things the way a user or a screen reader would — by role,
label, and text. There are no `data-testid` attributes in this app, on
purpose: a selector that only tests use can keep passing while the app is
unusable, whereas `getByRole("button", { name: "Add" })` breaking is a real
signal.

Where the app had no accessible name to grab (the Balances and History lists
are both `<ul>`s captioned by a styled `<p>`, not a heading), the fix went
into the app as an `aria-label` on the `<section>` — see the comment in
`app/g/[groupId]/balanceList.tsx`. Prefer that over a test ID: it improves
the product for assistive tech and gives the suite a stable handle in one
move.

## Isolation

Every scenario creates its own group through the UI, so it gets a fresh
`uuid` and touches no rows any other scenario can see. That is why this suite
runs `fullyParallel` while the Go suite needs `-p 1` — the Go tests truncate
shared tables, these don't, so there is no cleanup step and nothing to
serialize.

The one consequence worth knowing: **don't run `make test` and `make e2e`
against the same database at the same time.** The Go helper's truncation will
delete the groups a running scenario is mid-way through using. In CI they get
separate Postgres service containers, so this only bites locally.

## Adding a scenario

1. Write the Gherkin first, in domain language. If you can't say it without
   naming a button, the behavior isn't clear yet.
2. Run `npm run e2e`. Unmatched steps fail with a generated snippet to paste.
3. Implement the step by calling screens. If the screen method you want
   doesn't exist, add it there — not a locator in the step.
