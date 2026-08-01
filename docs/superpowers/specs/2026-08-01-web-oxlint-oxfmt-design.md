# Replace ESLint with oxlint + oxfmt in `web/` — design

- **Issue:** [#126](https://github.com/Ayut0/tally-up/issues/126)
- **Date:** 2026-08-01
- **Status:** approved, pending implementation

> Requirement-level keywords (**MUST**, **MUST NOT**, **SHOULD**, **MAY**) are
> used here in the RFC-2119 sense, as defined by `AGENTS.md` §
> [Requirement Level Keywords](../../../AGENTS.md).

## Problem

`web/` has a linter but no formatter.

`web/eslint.config.mjs` runs ESLint 9 flat config with `eslint-config-next`
(`core-web-vitals` + `typescript`), and `.github/workflows/ci.yaml` gates on
`npm run lint`. That half works.

The other half does not exist. There is no Prettier, no `.editorconfig`, no
`format` script, and no formatting check anywhere in `web/`. Formatting is
whatever each contributor's editor happens to do.

Speed is *not* the driver. At the time of writing `web/` is 16 files and ~2200
lines, which ESLint handles in 2.6s. But the surface is growing — the identity
and join flow landed in [#124](https://github.com/Ayut0/tally-up/pull/124), and
[#90](https://github.com/Ayut0/tally-up/issues/90) adds the group home — so the
tool chosen now is the one that has to scale.

## Decision

Adopt **oxlint + oxfmt** as the primary lint and format pass, replacing
`eslint-config-next`. ESLint survives in reduced form — one plugin,
`eslint-plugin-react-hooks` — because measurement showed oxlint has not ported
its React Compiler rules. See [Measured coverage](#measured-coverage).

The candidate set was Biome (one binary, lint + format) versus oxlint + oxfmt
(two binaries, one vendor). Biome's single-tool simplicity is a real virtue and
the reason it was the default expectation going in. It loses on two points that
are specific to *this* stack — Next 16 and Tailwind 4 — rather than on any
general deficiency:

| Dimension | oxlint + oxfmt | Biome |
| --- | --- | --- |
| Next.js rules | `nextjs` plugin ports `eslint-plugin-next` | No Next coverage. Switching silently drops `no-html-link-for-pages`, `no-img-element`, `no-sync-scripts`. |
| Tailwind 4 sorting | Built into the formatter, calling `prettier-plugin-tailwindcss`'s real `sortClasses` | `useSortedClasses` is a nursery *lint* rule with a hard-coded, non-configurable Tailwind config and an **unsafe** autofix (so it does not run on save). It cannot read Tailwind 4's CSS-based `@theme` in `app/globals.css`. |
| Formatter | `oxfmt`, 100% Prettier conformance | Built in |
| Binaries / configs | 2 / 2 | 1 / 1 |

Choosing Biome would mean paying for toolchain simplicity in the two places this
frontend actually lives. The second binary is the cheaper price.

Decisions locked during brainstorming:

| Dimension | Choice | Rationale |
| --- | --- | --- |
| Linter | **oxlint**, replacing `eslint-config-next` | Keeps the Next-specific rules that `eslint-config-next` contributes today — measurement confirmed all 21 are covered. |
| Formatter | **oxfmt** | Closes the actual gap, and is the only option that sorts Tailwind 4 classes using Tailwind's own ordering. |
| ESLint | **Retained, reduced to `eslint-plugin-react-hooks`** | `eslint-config-next` goes; ESLint stays solely for the 15 React Compiler hooks rules oxlint has not ported. See [Measured coverage](#measured-coverage) — this reverses the original "remove ESLint" decision on evidence. |
| CI formatting | **Blocking** `format:check` in the `web` job | An advisory formatter is a formatter that drifts. |
| Type-aware lint | **Off** | Needs the extra `oxlint-tsgolint` package, and `npm test` already runs `tsc --noEmit`. No gap to fill. |
| Import sorting | **Off** | See [Deliberate omissions](#deliberate-omissions). |

## Measured coverage

The original draft deferred this to an implementation-time "parity gate" that
diffed the two linters' *findings*. That gate was worthless: ESLint reports zero
findings on the current tree, so the diff would have compared an empty set to an
empty set and passed while silently dropping rules. The gate has to compare
**resolved rule sets**, not output. Measured up front instead, against
oxlint 1.76.0 / `eslint-plugin-oxlint` 1.76.0:

```
ESLint enabled:  85    covered by oxlint: 67    gap: 18
```

Method: `npx eslint --print-config app/page.tsx` to resolve what
`eslint-config-next` actually enables, intersected with the rule set encoded in
`eslint-plugin-oxlint`'s `flat/all` config. (`oxlint --rules` prints nothing in
1.76.0, and probing with `-D <rule>` does not distinguish real rule names from
invented ones, so the binary cannot self-report.)

The gap breaks down as:

| Missing | Count | Cost |
| --- | --- | --- |
| `react-hooks/*` React Compiler rules | 14 | **The entire real gap** — drives the ESLint decision below |
| `react/jsx-uses-react`, `react/jsx-uses-vars` | 2 | None. No-ops for the legacy JSX transform; oxlint tracks JSX usage natively. |
| `react/require-render-return` | 1 | None. Class-component-only; this codebase has zero class components. |
| `react/no-deprecated` | 1 | Minor. |

Two results matter beyond the arithmetic:

- **All 21 `@next/next` rules are covered**, including the three the Biome
  comparison turned on. The tool choice holds.
- **`exhaustive-deps` and `rules-of-hooks` are both covered.** The
  `exhaustive-deps` risk flagged in the first draft was aimed at the wrong rule.

`eslint-config-next` pulls `eslint-plugin-react-hooks` **7.1.1**, whose
recommended set enables 14 compiler-era rules oxlint has not ported —
`set-state-in-effect`, `set-state-in-render`, `purity`, `immutability`,
`preserve-manual-memoization`, `refs`, `static-components`, and others. They do
**not** require React Compiler to be enabled (it is not; `next.config.ts` is
bare) and they catch ordinary React bugs. `set-state-in-effect` in particular
covers the infinite-render class that the polling group home
([#90](https://github.com/Ayut0/tally-up/issues/90)) will be exposed to.

Biome does not implement these either, so this does not reopen the tool choice —
only the question of whether ESLint fully leaves. It does not.

## Design

### Configuration

`web/.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "react", "nextjs", "jsx-a11y", "import"],
  "categories": { "correctness": "error", "suspicious": "warn", "pedantic": "off" },
  "rules": {
    "react/react-in-jsx-scope": "off",
    "import/no-unassigned-import": "off"
  },
  "ignorePatterns": ["lib/api-types.ts", "lib/api-schemas/**"]
}
```

The `plugins` array **overwrites** oxlint's base set rather than extending it, so
it MUST list every plugin wanted — omitting one silently disables it.

Both `rules` entries suppress confirmed false positives, measured by running the
config against the current tree (26 findings, exactly these two rules, nothing
else):

- `react/react-in-jsx-scope` (25 hits) — oxlint does not assume Next's automatic
  JSX runtime. `eslint-config-next` disables this rule for the same reason.
- `import/no-unassigned-import` (1 hit) — fires on
  `app/layout.tsx:3`, `import "./globals.css"`. Side-effect CSS imports are
  correct and required in Next.

Categories start at `correctness: error` / `suspicious: warn` deliberately.
Enabling `pedantic` at the same time would bury the signal from these two
suppressions under new-rule noise. Tightening is a follow-up, once the baseline
is green.

`web/.oxfmtrc.json`:

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "sortTailwindcss": true,
  "sortImports": false,
  "ignorePatterns": ["lib/api-types.ts", "lib/api-schemas/**"]
}
```

Remaining format options stay at their defaults (`printWidth: 100`,
`tabWidth: 2`, `semi: true`, `trailingComma: "all"`). This repo has no prior
formatting convention to preserve, so there is nothing to match and no reason to
bikeshed.

`web/eslint.config.mjs`, rewritten from `eslint-config-next` down to one plugin:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import oxlint from "eslint-plugin-oxlint";

export default defineConfig([
  reactHooks.configs.flat["recommended-latest"],
  ...oxlint.configs["flat/react-hooks"],
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "lib/api-types.ts",
    "lib/api-schemas/**",
  ]),
]);
```

Note `configs.flat["recommended-latest"]`, not `configs.recommended` — in
`eslint-plugin-react-hooks` 7.x the latter is still the legacy shape
(`plugins: ["react-hooks"]` as an array) and ESLint 9 rejects it with a
migration error.

The `eslint-plugin-oxlint` line is what keeps the two linters from both
reporting the same rule. It disables exactly the hooks rules oxlint already
implements, verified as `react-hooks/exhaustive-deps` and
`react-hooks/rules-of-hooks`. The resulting split is clean and has no overlap:

| Owner | Count | Rules |
| --- | --- | --- |
| oxlint | 2 | `exhaustive-deps`, `rules-of-hooks` |
| ESLint | 15 | the 14 gap rules, plus `void-use-memo` from `recommended-latest` |

Because that boundary is derived from `eslint-plugin-oxlint` rather than
hand-written, it self-corrects as oxlint ports more rules: each newly-ported
rule moves from the ESLint column to the oxlint column on a dependency bump, with
no config edit and no window where a rule runs twice or not at all.

### Generated files

`lib/api-types.ts` (from `openapi-typescript`) and `lib/api-schemas/zod.gen.ts`
(from `@hey-api/openapi-ts`) are generator output that is committed to the repo.

Both tools MUST ignore them. oxfmt already skips `node_modules` and
`.gitignore`d paths, but these files are tracked, so they need explicit
`ignorePatterns` entries in both configs.

The failure this prevents: formatting rewrites a generated file, the next
`npm run gen:api-schemas` rewrites it back, and the repo acquires a permanent
phantom diff that alternates with whoever ran which command last.

### Package scripts

| Script | Before | After |
| --- | --- | --- |
| `lint` | `eslint` | `oxlint && eslint` |
| `format` | — | `oxfmt` |
| `format:check` | — | `oxfmt --check` |

oxlint runs first: it is the broader pass and the faster one, so it fails on the
common case before ESLint's slower start-up is paid at all.

`devDependencies`: drop `eslint-config-next`; add `oxlint`, `oxfmt`,
`eslint-plugin-react-hooks`, and `eslint-plugin-oxlint`. `eslint` itself stays.

Note that `eslint-plugin-react-hooks` is currently an indirect dependency via
`eslint-config-next`; removing that config makes it direct, so it MUST be added
explicitly rather than relied on transitively.

### CI

`.github/workflows/ci.yaml`, `web` job: add a `Format check` step running
`npm run format:check`, placed alongside the existing `Lint` step. It blocks.

Note that the `web` job reports but is not yet a required status check on
`main` — a deliberate open decision for the maintainer, carried over from
[#96](https://github.com/Ayut0/tally-up/issues/96) and **not** settled here.

## Implementation sequence

The ordering is the substance of this design, not incidental. The rule-coverage
question that used to sit at step 2 has been answered up front — see
[Measured coverage](#measured-coverage) — so what remains is sequencing the edit
so no commit is unreviewable.

1. **Add, don't replace.** Install oxlint + oxfmt, write `.oxlintrc.json` and
   `.oxfmtrc.json`. The existing `eslint-config-next` setup stays and remains
   the CI gate. Confirm `oxlint` is clean.
2. **Narrow ESLint.** Swap `eslint.config.mjs` to the react-hooks-only config,
   drop `eslint-config-next`, add `eslint-plugin-react-hooks` and
   `eslint-plugin-oxlint` as direct deps, repoint `lint` to `oxlint && eslint`.
   Confirm both linters are clean and that the owner split is 2/15 as specified.
3. **Format the tree.** `oxfmt --write` across `web/`, as its **own commit**
   containing no logic change. Record its SHA in `.git-blame-ignore-revs` at the
   repo root. GitHub's blame view honours that file automatically; local `git
   blame` does not, so the file MUST carry a comment telling readers to run
   `git config blame.ignoreRevsFile .git-blame-ignore-revs` once. A
   blame-ignore file nobody has configured is a file that silently does nothing.
4. **Gate formatting in CI.** Add the `Format check` step.

Steps 2 and 3 MUST remain distinct commits. A whole-tree formatting blast is
unreviewable by inspection, so it MUST NOT carry anything a reviewer is expected
to actually read.

## Deliberate omissions

**Type-aware linting** (`options.typeAware`). Requires the separate
`oxlint-tsgolint` package. `npm test` already runs `tsc --noEmit`, so the type
errors this would surface are caught today. Adding it now buys a second opinion
on a question already answered.

**Import sorting** (`sortImports`). `app/layout.tsx` contains
`import "./globals.css"` — a side-effectful import whose *position* determines
CSS cascade order. An automated reorder could change rendered styles with no
test capable of catching it. The risk is small but the reward is cosmetic, and
it is not worth coupling to a migration whose value is elsewhere. Revisit as its
own change, with visual verification.

## Risks and rollback

| Risk | Mitigation |
| --- | --- |
| oxlint's `exhaustive-deps` has open false-positive bugs ([oxc#20664](https://github.com/oxc-project/oxc/issues/20664)) | Accepted. The rule is now oxlint's rather than ESLint's, so a false positive is visible and local. Fallback is that one rule at `warn` plus a follow-up issue. |
| Two linters drift into overlapping or duplicated findings | The boundary is not hand-maintained — `eslint-plugin-oxlint` derives it. Verified today as a clean 2/15 split with no overlap. |
| oxlint's `nextjs` port diverges from `eslint-plugin-next` in behaviour, not just rule names | Coverage is confirmed by name only; behavioural equivalence is not. Accepted — the rules are advisory-grade, and any divergence surfaces as a finding rather than a silent miss. |
| Formatting commit pollutes `git blame` | Isolated commit, listed in `.git-blame-ignore-revs`. |
| Generated files drift | Verification below requires re-running both generators and confirming a clean `git diff`. |

Rollback before step 3 is reverting two commits' worth of config. After step 3
it is a `git revert` of a single, isolated, logic-free commit.

## Verification

- `npm run lint` passes — both `oxlint` and the reduced `eslint`.
- The rule split is 2 (oxlint) / 15 (ESLint) with no rule active in both.
- `web/eslint.config.mjs` no longer references `eslint-config-next`, and that
  package is gone from `package.json`.
- `npm run format:check` passes locally and blocks in CI.
- `npm run gen:api-types` and `npm run gen:api-schemas` both produce a clean
  `git diff` — proving the ignore patterns hold.
- `npm test` (typecheck + vitest) and `npm run build` still pass.
