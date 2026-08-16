# 5. Storybook interaction tests are a separate Vitest project from the logic suite

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Yuto
- **Related:** Issue #226 (this decision); Issue #138 (the "`web/` suite never
  renders JSX" rule this sits next to, not inside); Issue #184 (Storybook
  build-only CI step, which this extends); map #137 (`docs/adr/0004-web-form-architecture.md`
  is a separate, still-open destination — this ADR does not preempt it)

## Context

#226 asked whether `web/` has working Storybook interaction (`play`-function)
tests. It doesn't: one story
(`app/g/[groupId]/memberList.stories.tsx`'s `RemoveBlockedByNonzeroBalance`)
already has a `play` function, but nothing executes it — CI's `storybook
build` step is deliberately build-only (#184), and `npm test`
(`typecheck && vitest run`) never touches `.stories.tsx` files.

#138 settled, explicitly "do not re-open," that the `web/` vitest suite
verifying form logic never renders JSX — pure rules go to `lib/`, stateful
ones to a colocated hook tested with `renderHook`, JSX is never unit-tested.
That rule is enforced mechanically: `.oxlintrc.json` bans the `render` import
from `@testing-library/react` with the message "web/ tests never render
JSX." On its face, wiring up a tool that renders components to click through
them looks like exactly what #138 closed off.

It isn't the same question. #138 answered "what verifies a `web/` form's
*decision logic*" — the scope line drawn in map #137 is "does it touch user
input," i.e. keystroke-to-payload correctness. A Storybook interaction test
answers a different question: does the *rendered* component behave
correctly when clicked through (a dialog opens, a mocked network call
fires, error text appears)? `RemoveBlockedByNonzeroBalance` isn't testing
decision logic in isolation — it's testing a rendered interaction sequence,
which is precisely the thing #138 said unit tests must not attempt. Nothing
in #138 forbids a *different* tool, running in a *different* Vitest project,
from rendering JSX for that different purpose.

## Decision

Adopt `@storybook/addon-vitest` with Vitest's browser mode
(`@vitest/browser-playwright`, headless Chromium) to run `play` functions,
as a **second Vitest project** alongside the existing jsdom logic project —
not folded into it.

- A new, separate config file, `vitest.storybook.config.ts`, holds the
  `storybook` project (wired via `storybookTest()` from
  `@storybook/addon-vitest/vitest-plugin`) — not a `test.projects` array
  merged into the existing `vitest.config.ts`. `vitest.config.ts` (the
  jsdom logic/hook project) stays untouched. A merged-config `projects`
  array is Vitest's own documented pattern here, but it requires a
  `--project` CLI filter to keep the two apart; a separate file makes
  `npm test`'s default `vitest run` structurally unaware of the browser
  project, not reliant on remembering a flag.
- A new script, `test:storybook`, runs `vitest run --config
  vitest.storybook.config.ts`. It is **not** part of `npm test` — `npm
  test` keeps meaning exactly what #138 settled: the suite that never
  renders JSX. That claim stays true by `grep`, not just by convention.
- CI's `web` job gets a new `test:storybook` step, advisory (not blocking)
  for now — matching the existing `storybook build` step's status, and not
  preempting #96's separate, still-open decision about which `web` job
  steps become required checks. `storybook build` stays; it catches broken
  stories/config for components with no `play` function, which the browser
  project alone doesn't guarantee to cover.
- `play` functions are opt-in, at the same bar as writing a story at all
  (`web/AGENTS.md`): add one when there's a multi-step interaction worth
  verifying (dialog confirm, form submit, error path), not for every
  interactive story.
- `RemoveBlockedByNonzeroBalance` becomes the first story actually verified
  by this setup, the same proving role `BalanceList` played for #184.

## Consequences

**Positive**

- Interaction behavior that spans multiple rendered components (a list, a
  confirm dialog, an MSW-mocked network round-trip) gets a real, automated
  check — a class of bug #138's hook tests structurally cannot see, because
  it lives in the rendering/wiring, not in decided values.
- `addon-vitest` doesn't only run stories with an explicit `play` — every
  story gets rendered in the browser project as a base smoke check (fails if
  a story throws on render), even ones with no `play` function. That's a
  strictly stronger check than `storybook build` gives today, which only
  proves the bundle compiles, not that any story actually renders.
- `npm test`'s meaning stays textually unambiguous; a reader doesn't have to
  know this ADR exists to trust what `npm test` does.
- `.oxlintrc.json`'s `render` ban needs no change — the browser project uses
  Storybook's own portable-stories API (`composeStories`/`storybookTest`),
  not `@testing-library/react`'s `render`, so the two layers don't collide
  even mechanically.

**Negative / accepted trade-offs**

- New CI cost: Playwright's Chromium binary must be available to the `web`
  job (installed step or a Playwright-image container), on top of the
  existing `npm ci`/build/lint steps.
- Two Vitest "suites" now exist in `web/` (jsdom logic, browser Storybook),
  which a future contributor must learn are deliberately separate rather
  than an oversight — this ADR is that explanation.
- `test:storybook` staying advisory means a broken interaction test doesn't
  block a merge yet, same gap `storybook build` already accepted in #184.

## Alternatives considered

- **`@storybook/test-runner`** (Jest + Playwright against a built/served
  Storybook instance). Rejected: Storybook's own current docs steer new
  setups toward `addon-vitest`; picking the runner now means adopting a path
  Storybook itself is moving away from.
- **Fold the browser project into `npm test`.** Rejected: blurs the textual
  claim that `npm test` never renders JSX, trading a one-line script split
  for ambiguity every future reader has to resolve by reading this ADR
  instead of the script name.
- **Require a `play` function for every interactive story.** Rejected: raises
  the bar above `web/AGENTS.md`'s existing opt-in bar for stories themselves,
  for no stated benefit — most interactive stories don't have a multi-step
  sequence worth locking down.
- **Treat #226 as reopening #138 and block on renewed sign-off before any
  work.** Rejected once the scope distinction above held up: #138's rule is
  about the assertions inside the vitest logic suite, not a blanket ban on
  any tool ever rendering a component for any purpose.
