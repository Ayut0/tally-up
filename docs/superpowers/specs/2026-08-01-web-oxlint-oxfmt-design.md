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

Adopt **oxlint + oxfmt** and retire ESLint.

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
| Linter | **oxlint**, replacing ESLint | Keeps the Next-specific rules that `eslint-config-next` contributes today. A migration that drops them is a downgrade wearing a speed benchmark. |
| Formatter | **oxfmt** | Closes the actual gap, and is the only option that sorts Tailwind 4 classes using Tailwind's own ordering. |
| ESLint | **Removed**, but only after a parity gate | Keeping both means two lint configs to hold in sync and duplicate findings on every run. Removing it on faith risks a silent rule regression. Hence the gate. |
| CI formatting | **Blocking** `format:check` in the `web` job | An advisory formatter is a formatter that drifts. |
| Type-aware lint | **Off** | Needs the extra `oxlint-tsgolint` package, and `npm test` already runs `tsc --noEmit`. No gap to fill. |
| Import sorting | **Off** | See [Deliberate omissions](#deliberate-omissions). |

## Design

### Configuration

`web/.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "react", "nextjs", "jsx-a11y", "import"],
  "categories": { "correctness": "error", "suspicious": "warn", "pedantic": "off" },
  "ignorePatterns": ["lib/api-types.ts", "lib/api-schemas/**"]
}
```

The `plugins` array **overwrites** oxlint's base set rather than extending it, so
it MUST list every plugin wanted — omitting one silently disables it.

Categories start at `correctness: error` / `suspicious: warn` deliberately.
Enabling `pedantic` in the same change would flood the parity diff in step 2
with new-rule noise and bury the ESLint-vs-oxlint signal it exists to show.
Tightening is a follow-up, once the baseline is green.

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
| `lint` | `eslint` | `oxlint` |
| `format` | — | `oxfmt` |
| `format:check` | — | `oxfmt --check` |

`devDependencies`: drop `eslint` and `eslint-config-next`; add `oxlint` and
`oxfmt`.

### CI

`.github/workflows/ci.yaml`, `web` job: add a `Format check` step running
`npm run format:check`, placed alongside the existing `Lint` step. It blocks.

Note that the `web` job reports but is not yet a required status check on
`main` — a deliberate open decision for the maintainer, carried over from
[#96](https://github.com/Ayut0/tally-up/issues/96) and **not** settled here.

## Implementation sequence

The ordering is the substance of this design, not incidental. ESLint is not
deleted on the strength of a vendor's compatibility table.

1. **Add, don't replace.** Install oxlint + oxfmt, write both configs. ESLint
   stays installed and remains the CI gate.
2. **Parity gate.** Run `oxlint` and `eslint` over the same tree, diff the
   findings, and record the delta in the PR body. Every ESLint finding that
   oxlint does not reproduce MUST be either explained (rule intentionally
   dropped) or closed (rule enabled) before proceeding.
3. **Retire ESLint** — only if step 2 is clean. Delete `web/eslint.config.mjs`,
   drop both deps, repoint the `lint` script.
4. **Format the tree.** `oxfmt --write` across `web/`, as its **own commit**
   containing no logic change. Record its SHA in `.git-blame-ignore-revs` at the
   repo root. GitHub's blame view honours that file automatically; local `git
   blame` does not, so the file MUST carry a comment telling readers to run
   `git config blame.ignoreRevsFile .git-blame-ignore-revs` once. A
   blame-ignore file nobody has configured is a file that silently does nothing.
5. **Gate formatting in CI.** Add the `Format check` step.

Steps 3 and 4 MUST remain distinct commits. A whole-tree formatting blast is
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
| oxlint's `exhaustive-deps` has open false-positive bugs ([oxc#20664](https://github.com/oxc-project/oxc/issues/20664)) | Surfaces in step 2. Fallback is that rule at `warn` plus a follow-up issue — not abandoning the migration. |
| oxlint's `nextjs` port diverges from `eslint-plugin-next` | Step 2 is exactly this check, against the real config on the real tree. |
| Formatting commit pollutes `git blame` | Isolated commit, listed in `.git-blame-ignore-revs`. |
| Generated files drift | Acceptance criteria require re-running both generators and confirming a clean `git diff`. |

Rollback before step 4 is deleting two config files and reinstating one. After
step 4 it is a `git revert` of a single, isolated, logic-free commit.

## Verification

- `npm run lint` (oxlint) passes; `web/eslint.config.mjs` and both ESLint deps
  are gone.
- Parity delta from step 2 recorded in the PR, with every gap explained or
  closed.
- `npm run format:check` passes locally and blocks in CI.
- `npm run gen:api-types` and `npm run gen:api-schemas` both produce a clean
  `git diff` — proving the ignore patterns hold.
- `npm test` (typecheck + vitest) and `npm run build` still pass.
