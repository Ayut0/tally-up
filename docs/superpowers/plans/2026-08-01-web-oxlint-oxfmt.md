# web/ oxlint + oxfmt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `web/` a formatter it currently lacks, and replace `eslint-config-next` with oxlint, keeping ESLint only for the React Compiler hooks rules oxlint has not ported.

**Architecture:** oxlint becomes the primary lint pass and oxfmt the formatter. ESLint survives reduced to a single plugin (`eslint-plugin-react-hooks`), with `eslint-plugin-oxlint` deriving the boundary between the two so no rule runs in both. Work lands as four independently revertable commits; the whole-tree formatting pass is isolated so it can never hide a behavioural change.

**Tech Stack:** Next.js 16.2.11, React 19.2.4, TypeScript 5, Tailwind 4, Vitest 4, Node 22 (CI).

**Spec:** [docs/superpowers/specs/2026-08-01-web-oxlint-oxfmt-design.md](../specs/2026-08-01-web-oxlint-oxfmt-design.md)
**Issue:** [#126](https://github.com/Ayut0/tally-up/issues/126)

## Global Constraints

- All `npm` commands run from `web/`, never the repo root. The repo root has no `package.json`.
- Branch is `feat/issue-126-web-oxlint-oxfmt` in worktree `.claude/worktrees/feat+issue-126-web-oxlint-oxfmt`. Do not switch branches; do not rebase or force-push without asking the maintainer (AGENTS.md § Conventions).
- Pinned versions, verified working during design: `oxlint@1.76.0`, `oxfmt@0.61.0`, `eslint-plugin-oxlint@1.76.0`, `eslint-plugin-react-hooks@7.1.1`.
- These two files are committed generator output and MUST be excluded from every tool: `lib/api-types.ts`, `lib/api-schemas/**`.
- `eslint` itself stays a devDependency. Only `eslint-config-next` is removed.
- Two things the spec deliberately excludes — do not add them, even though oxc documents both: `options.typeAware` (needs the extra `oxlint-tsgolint` package; `npm test` already runs `tsc --noEmit`) and `sortImports` (see Task 1, Step 5).
- Never run `git stash` bare — other worktrees share the stash stack.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
| --- | --- |
| `web/.oxlintrc.json` | **Create.** Primary lint config: plugin set, severity categories, two false-positive suppressions, generated-file ignores. |
| `web/.oxfmtrc.json` | **Create.** Format config: Tailwind sorting on, import sorting off, generated-file ignores. |
| `web/eslint.config.mjs` | **Rewrite.** Shrinks from `eslint-config-next` to `eslint-plugin-react-hooks` + the oxlint dedupe layer. |
| `web/package.json` | **Modify.** Dependency swap and three script changes. |
| `.github/workflows/ci.yaml` | **Modify.** One new `Format check` step in the `web` job. |
| `.git-blame-ignore-revs` | **Create** at repo root. Holds the formatting commit SHA plus setup instructions. |

---

### Task 1: oxlint and oxfmt alongside the existing setup

Adds both tools and their configs without touching ESLint. At the end of this task `eslint-config-next` is still the gate, so a reviewer can reject the oxlint config without unpicking anything else.

**Files:**
- Create: `web/.oxlintrc.json`
- Create: `web/.oxfmtrc.json`
- Modify: `web/package.json` (devDependencies + `format`/`format:check` scripts)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run format:check` (exits non-zero when files need formatting), `npx oxlint` clean against the tree. Task 2 relies on `.oxlintrc.json` existing. Task 3 relies on `.oxfmtrc.json` and `npm run format`.

- [ ] **Step 1: Install the two tools**

```bash
cd web
npm i -D oxlint@1.76.0 oxfmt@0.61.0
```

- [ ] **Step 2: Confirm the versions landed**

Run: `npx oxlint --version && npx oxfmt --version`
Expected: `Version: 1.76.0` then `Version: 0.61.0`

- [ ] **Step 3: Create `web/.oxlintrc.json`**

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "react", "nextjs", "jsx-a11y", "import"],
  "categories": {
    "correctness": "error",
    "suspicious": "warn",
    "pedantic": "off"
  },
  "rules": {
    "react/react-in-jsx-scope": "off",
    "import/no-unassigned-import": "off"
  },
  "ignorePatterns": ["lib/api-types.ts", "lib/api-schemas/**"]
}
```

The `plugins` array **replaces** oxlint's default plugin set rather than adding to it, so every plugin wanted must be listed. The two `rules` entries suppress confirmed false positives: `react-in-jsx-scope` fires 25 times because oxlint does not assume Next's automatic JSX runtime, and `import/no-unassigned-import` fires on `app/layout.tsx:3` (`import "./globals.css"`), which is correct and required in Next.

- [ ] **Step 4: Run oxlint and verify it is clean**

Run: `cd web && npx oxlint`
Expected: no findings printed. If `react-in-jsx-scope` or `no-unassigned-import` appear, the `rules` block did not take effect — check for a typo in the rule names.

- [ ] **Step 5: Create `web/.oxfmtrc.json`**

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "sortTailwindcss": true,
  "sortImports": false,
  "ignorePatterns": ["lib/api-types.ts", "lib/api-schemas/**"]
}
```

`sortImports` is deliberately off: `app/layout.tsx` contains `import "./globals.css"`, a side-effectful import whose position determines CSS cascade order. Reordering it could change rendered styles with no test able to catch it.

- [ ] **Step 6: Add the format scripts to `web/package.json`**

In the `scripts` block, leave `lint` alone for now and add:

```json
    "format": "oxfmt",
    "format:check": "oxfmt --check",
```

- [ ] **Step 7: Verify `format:check` runs and reports work to do**

Run: `cd web && npm run format:check`
Expected: exits non-zero, listing files that would change. This is the correct result — nothing has been formatted yet. Record roughly how many files it names; Task 3 reformats exactly these.

- [ ] **Step 8: Confirm generated files are excluded**

Run: `cd web && npx oxfmt --check 2>&1 | grep -c "api-types\|zod.gen"`
Expected: `0`. A non-zero count means `ignorePatterns` is wrong — fix before continuing, or Task 3 will corrupt generated output.

- [ ] **Step 9: Commit**

```bash
cd /Users/yuto/Documents/Web_Development/projects/tally-up/.claude/worktrees/feat+issue-126-web-oxlint-oxfmt
git add web/.oxlintrc.json web/.oxfmtrc.json web/package.json web/package-lock.json
git commit -m "$(cat <<'EOF'
feat: add oxlint and oxfmt to web/ (#126)

Adds both tools and their configs without changing what gates CI yet —
eslint-config-next still runs. oxlint is clean against the current tree
once two confirmed false positives are suppressed: react-in-jsx-scope
(oxlint does not assume Next's automatic JSX runtime) and
import/no-unassigned-import (which fires on globals.css).

sortImports stays off because app/layout.tsx imports globals.css for its
side effect, and its position determines CSS cascade order.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Narrow ESLint to react-hooks, hand linting to oxlint

Replaces `eslint-config-next` with a one-plugin ESLint config and makes `lint` run both tools. This is the task that changes what CI enforces.

**Files:**
- Modify: `web/eslint.config.mjs` (full rewrite, currently 18 lines)
- Modify: `web/package.json` (devDependencies + `lint` script)

**Interfaces:**
- Consumes: `web/.oxlintrc.json` from Task 1.
- Produces: `npm run lint` running `oxlint && eslint`, both clean. Task 4 wires this into CI unchanged.

- [ ] **Step 1: Swap the dependencies**

```bash
cd web
npm uninstall eslint-config-next
npm i -D eslint-plugin-react-hooks@7.1.1 eslint-plugin-oxlint@1.76.0
```

`eslint-plugin-react-hooks` is currently only an indirect dependency via `eslint-config-next`. Removing that config makes it direct, so it must be installed explicitly rather than relied on transitively.

- [ ] **Step 2: Verify the rule split before writing the config**

Run:

```bash
cd web && node --input-type=module -e '
import rh from "eslint-plugin-react-hooks";
import ox from "eslint-plugin-oxlint";
const merged = {};
Object.assign(merged, rh.configs.flat["recommended-latest"].rules || {});
for (const b of ox.configs["flat/react-hooks"]) Object.assign(merged, b.rules || {});
const on = Object.entries(merged).filter(([, v]) => { const s = Array.isArray(v) ? v[0] : v; return s !== "off" && s !== 0; });
const off = Object.entries(merged).filter(([, v]) => { const s = Array.isArray(v) ? v[0] : v; return s === "off" || s === 0; });
console.log("ESLint keeps:", on.length);
console.log("Deferred to oxlint:", off.map(([k]) => k).join(", "));'
```

Expected exactly:

```
ESLint keeps: 15
Deferred to oxlint: react-hooks/exhaustive-deps, react-hooks/rules-of-hooks
```

If these numbers differ, a dependency version drifted. Stop and reconcile against the spec's [Measured coverage](../specs/2026-08-01-web-oxlint-oxfmt-design.md#measured-coverage) section before continuing — the whole point of this design is that the two linters do not overlap.

- [ ] **Step 3: Rewrite `web/eslint.config.mjs`**

Replace the entire file with:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import oxlint from "eslint-plugin-oxlint";

// oxlint (.oxlintrc.json) is the primary lint pass and covers everything
// eslint-config-next used to, including all 21 @next/next rules. ESLint
// remains only for the React Compiler hooks rules oxlint has not ported —
// set-state-in-effect, purity, immutability and friends. The oxlint config
// below disables the two hooks rules oxlint *does* implement, so no rule
// ever runs in both linters; that boundary updates itself as oxlint ports
// more rules.
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

Use `configs.flat["recommended-latest"]`, **not** `configs.recommended`. In `eslint-plugin-react-hooks` 7.x the latter is still the legacy shape (`plugins: ["react-hooks"]` as an array) and ESLint 9 rejects it with a config-migration error.

- [ ] **Step 4: Run ESLint and verify it is clean**

Run: `cd web && npx eslint; echo "exit=$?"`
Expected: no findings, `exit=0`. Note the explicit `echo` — piping ESLint through `tail` or `head` masks its exit code.

- [ ] **Step 5: Point `lint` at both tools**

In `web/package.json`, change the `lint` script:

```json
    "lint": "oxlint && eslint",
```

oxlint runs first because it is the broader and faster pass, so the common failure is reported before ESLint's slower start-up is paid.

- [ ] **Step 6: Verify the combined script**

Run: `cd web && npm run lint; echo "exit=$?"`
Expected: no findings from either tool, `exit=0`.

- [ ] **Step 7: Confirm `eslint-config-next` is gone**

Run: `cd web && grep -c "eslint-config-next" package.json eslint.config.mjs`
Expected: `0` for both files.

- [ ] **Step 8: Verify the rest of the toolchain still works**

Run: `cd web && npm test && npm run build`
Expected: typecheck passes, vitest passes, Next build succeeds. This catches the case where removing `eslint-config-next` disturbed a transitive dependency the build relied on.

- [ ] **Step 9: Commit**

```bash
cd /Users/yuto/Documents/Web_Development/projects/tally-up/.claude/worktrees/feat+issue-126-web-oxlint-oxfmt
git add web/eslint.config.mjs web/package.json web/package-lock.json
git commit -m "$(cat <<'EOF'
feat: replace eslint-config-next with oxlint in web/ (#126)

oxlint covers 67 of the 85 rules eslint-config-next enabled, including
all 21 @next/next rules and both exhaustive-deps and rules-of-hooks.

ESLint stays for the 14 React Compiler hooks rules oxlint has not ported
(set-state-in-effect, purity, immutability and others). They need no
React Compiler, catch ordinary React bugs, and Biome lacks them too.
eslint-plugin-oxlint derives the boundary between the two linters, so no
rule runs twice and the split self-corrects as oxlint ports more.

eslint-plugin-react-hooks becomes a direct dependency — it was only
transitive via eslint-config-next.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Format the tree in an isolated commit

The one commit that touches every file. It must contain no logic change, so a reviewer can approve it without reading it.

**Files:**
- Modify: every file under `web/` that oxfmt rewrites, except the excluded generated ones
- Create: `.git-blame-ignore-revs` at the repo root

**Interfaces:**
- Consumes: `.oxfmtrc.json` and the `format` script from Task 1.
- Produces: a tree where `npm run format:check` exits 0. Task 4 gates on exactly this.

- [ ] **Step 1: Confirm the working tree is clean**

Run: `git status --short`
Expected: no output. A formatting pass mixed with unrelated edits is unreviewable — do not proceed otherwise.

- [ ] **Step 2: Format**

```bash
cd web && npm run format
```

- [ ] **Step 3: Verify no generated file was touched**

Run: `git status --short -- web/lib/api-types.ts web/lib/api-schemas/`
Expected: no output. If either appears, `ignorePatterns` failed — `git checkout` those paths, fix `.oxfmtrc.json`, and restart this task.

- [ ] **Step 4: Verify the diff is formatting-only**

Run: `git diff --stat` then skim `git diff`.
Expected: whitespace, quotes, line breaks, and reordered Tailwind class strings inside `className` only. Any changed identifier, import path, or JSX structure means something is wrong — investigate before committing.

- [ ] **Step 5: Confirm the tree is now clean by oxfmt's own check**

Run: `cd web && npm run format:check; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 6: Verify behaviour did not change**

Run: `cd web && npm run lint && npm test && npm run build`
Expected: all pass. Tailwind class reordering is the one part of this pass that can theoretically change rendering, so the build passing matters here.

- [ ] **Step 7: Commit the formatting alone**

```bash
cd /Users/yuto/Documents/Web_Development/projects/tally-up/.claude/worktrees/feat+issue-126-web-oxlint-oxfmt
git add -A web/
git commit -m "$(cat <<'EOF'
style: format web/ with oxfmt (#126)

Formatting only, no logic change. Isolated so it cannot hide a
behavioural change in review, and recorded in .git-blame-ignore-revs in
the following commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Capture the SHA and write `.git-blame-ignore-revs`**

```bash
FMT_SHA=$(git rev-parse HEAD)
cat > .git-blame-ignore-revs <<EOF
# Revisions listed here are excluded from \`git blame\`.
#
# GitHub's blame view reads this file automatically. Local git does not —
# run this once per clone to get the same behaviour:
#
#     git config blame.ignoreRevsFile .git-blame-ignore-revs

# style: format web/ with oxfmt (#126)
$FMT_SHA
EOF
cat .git-blame-ignore-revs
```

- [ ] **Step 9: Verify the ignore file works**

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
git blame -- web/app/layout.tsx | head -5
```

Expected: the listed lines attribute to their original authoring commits, not to the formatting commit.

- [ ] **Step 10: Commit**

```bash
git add .git-blame-ignore-revs
git commit -m "$(cat <<'EOF'
chore: ignore the oxfmt formatting commit in git blame (#126)

GitHub honours this file automatically; local git needs
`git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone,
which the file's own comment explains.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Gate formatting in CI

**Files:**
- Modify: `.github/workflows/ci.yaml:117-118` (insert a step after `Lint`)

**Interfaces:**
- Consumes: `npm run format:check` from Task 1, and the formatted tree from Task 3.
- Produces: nothing downstream.

- [ ] **Step 1: Add the step**

In the `web` job, replace:

```yaml
      - name: Lint
        run: npm run lint

      - name: Build
```

with:

```yaml
      - name: Lint
        run: npm run lint

      - name: Format check
        run: npm run format:check

      - name: Build
```

The job already sets `working-directory: web` under `defaults.run`, so the step needs no path of its own.

- [ ] **Step 2: Verify the step landed in the right place with the right indentation**

There is no YAML parser available in this environment (`python3` has no
`pyyaml`), so check the shape textually:

```bash
cd /Users/yuto/Documents/Web_Development/projects/tally-up/.claude/worktrees/feat+issue-126-web-oxlint-oxfmt
sed -n '/^  web:/,$p' .github/workflows/ci.yaml | grep -n "name:\|run:"
```

Expected exactly (the first `run:` is the job's `defaults.run`, not a step):

```
6:      run:
18:      - run: npm ci
20:      - name: Lint
21:        run: npm run lint
23:      - name: Format check
24:        run: npm run format:check
26:      - name: Build
27:        run: npm run build
29:      - name: Test
30:        run: npm test
```

Confirm `- name: Format check` sits at the same indentation (six spaces) as
`- name: Lint`. A misindented step is the most common way this edit breaks, and
YAML will often still parse it — into the wrong place.

- [ ] **Step 3: Verify the gate actually fails on unformatted code**

A gate never observed failing is not known to work. Temporarily break formatting, confirm the command rejects it, then restore:

```bash
cd web
printf '\n\n\n' >> lib/split.ts
npm run format:check; echo "exit=$? (expected non-zero)"
git checkout -- lib/split.ts
npm run format:check; echo "exit=$? (expected 0)"
```

- [ ] **Step 4: Run the full local equivalent of the CI job**

Run: `cd web && npm ci && npm run lint && npm run format:check && npm run build && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuto/Documents/Web_Development/projects/tally-up/.claude/worktrees/feat+issue-126-web-oxlint-oxfmt
git add .github/workflows/ci.yaml
git commit -m "$(cat <<'EOF'
ci: block the web job on oxfmt formatting (#126)

An advisory formatter is a formatter that drifts. Verified the gate
rejects unformatted input rather than assuming it does.

Note the web job still reports without being a required status check on
main — that remains the maintainer's open decision from #96.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verify generated output is untouched, then open the PR

The failure this guards against is silent: a formatter that rewrites generated files produces a phantom diff that reappears every time someone runs a generator.

**Files:** none modified — this task is verification plus the PR.

- [ ] **Step 1: Regenerate both artifacts**

```bash
cd web
npm run gen:api-types
npm run gen:api-schemas
```

- [ ] **Step 2: Confirm the generators produce no diff**

Run: `git status --short -- web/lib/api-types.ts web/lib/api-schemas/`
Expected: no output. Any diff means a tool reformatted generated code despite `ignorePatterns`, and Task 1's config must be fixed.

- [ ] **Step 3: Confirm the final rule split one more time**

Run the Node one-liner from Task 2, Step 2.
Expected: `ESLint keeps: 15`, deferred `react-hooks/exhaustive-deps, react-hooks/rules-of-hooks`.

- [ ] **Step 4: Full verification sweep**

Run: `cd web && npm run lint && npm run format:check && npm test && npm run build`
Expected: all pass. Record the actual output for the PR body — AGENTS.md § Verify requires reporting real output, not a claim that it passed.

- [ ] **Step 5: Self-review the diff in reviewer mode**

Per AGENTS.md § Review Independence Gates, reset into reviewer mode and read `git diff origin/main...HEAD` — judging the diff, not the intent. Use the `code-review-guideline` skill. Fix any Critical or Major finding before opening the PR.

Review the four commits separately; the formatting commit should be skimmed for anything that is not whitespace or class reordering, not read line by line.

- [ ] **Step 6: Push and open the PR**

```bash
cd /Users/yuto/Documents/Web_Development/projects/tally-up/.claude/worktrees/feat+issue-126-web-oxlint-oxfmt
git push -u origin feat/issue-126-web-oxlint-oxfmt
```

Then open a PR linked to #126. The body must include: the measured coverage numbers (85 enabled / 67 covered / 18 gap), the 2-vs-15 rule split, the verification output from Step 4, and the two accepted risks from the spec — that `@next/next` coverage was confirmed by rule *name* rather than behaviour, and that two linters is the price paid for the 14 React Compiler rules.

---

## Notes for the implementer

**Why two linters.** It looks redundant and it was not the original plan. The design measured oxlint against `eslint-config-next` and found 18 uncovered rules, 14 of which are React Compiler hooks rules that catch real bugs (`set-state-in-effect` guards the infinite-render class that #90's polling UI will hit). Biome lacks them too. Keeping one ESLint plugin was the cheapest way to not lose them.

**Do not "simplify" by deleting the `eslint-plugin-oxlint` line.** Without it, `exhaustive-deps` and `rules-of-hooks` run in both linters and every violation is reported twice.

**If a step's expected output does not match**, stop rather than adapting around it. The numbers in this plan were measured on this tree at these versions; a mismatch means something drifted and the divergence matters more than finishing the task.
