# React Hook Form for `Record`-keyed dynamic fields + cross-field validation

Findings for [issue #139](https://github.com/Ayut0/tally-up/issues/139). **Facts only** —
this document deliberately makes no recommendation about whether to adopt React Hook Form
(RHF) in `web/app/g/[groupId]/add/page.tsx`. A later session decides.

## How to read this

Every claim is tagged with where it comes from:

| Tag | Meaning |
| --- | --- |
| **[doc]** | Stated in the library's own documentation. |
| **[src]** | Read off the library's published source. Inference, not a promise — the maintainers may change it without it being a breaking change. |
| **[obs]** | Observed by running the libraries locally (see [Appendix](#appendix-how-the-obs-facts-were-produced)). True of the exact versions probed; not a documented guarantee. |
| **[gap]** | The sources do not say. Collected in [Unknowns](#unknowns--could-not-establish-from-sources). |

Versions this was established against (latest at 2026-08-02):

- `react-hook-form@7.84.0` (published 2026-08-01); `8.0.0-beta.3` also exists (2026-07-10).
- `@hookform/resolvers@5.6.0` (published 2026-08-01).
- `zod@4.4.3` — the version `web/package.json`'s `^4.4.3` resolves to today.
- Repo context: `next@16.2.11`, `react@19.2.4`, `@tanstack/react-query@^5.101.4`.

---

## 1. `Record`-keyed dynamic fields

The shape in question: `amounts` / `weights` are `Record<string, number>` keyed by member
id (UUIDv7 — starts with a digit, contains hyphens), and the key set changes as
participants are toggled.

### 1.1 Flat dotted-path registration is the supported mechanism

RHF's field names are **paths**, and the docs' own table for `register` says the submitted
value is built by walking that path: **[doc]**

| Input Name | Submit Result |
| --- | --- |
| `register("firstName")` | `{ firstName: value }` |
| `register("name.firstName")` | `{ name: { firstName: value } }` |
| `register("name.firstName.0")` | `{ name: { firstName: [ value ] } }` |

— <https://react-hook-form.com/docs/useform/register> (source:
[`src/content/docs/useform/register.mdx`](https://github.com/react-hook-form/documentation/blob/master/src/content/docs/useform/register.mdx))

So `register(\`amounts.${memberId}\`)` is the idiomatic construction, and nothing in the
API requires the sub-keys to be indices. The docs never discuss `Record`-shaped subtrees
explicitly — the third row above shows that a **numeric** last segment produces an array,
which is the only key-shape rule the table states. **[gap]** on `Record`s as such.

### 1.2 The register docs warn about exactly the key shape we have

> Names must not start with a number or use numbers as standalone keys, and should avoid
> special characters. For TypeScript consistency, only dot syntax is supported—bracket
> syntax (`[]`) will not work for array form values.

— <https://react-hook-form.com/docs/useform/register> ("Rules" admonition) **[doc]**

A UUIDv7 such as `01924abc-1234-7abc-8def-0123456789ab` **starts with a number** and
contains hyphens, so it is textually against that advice. The mechanism behind the advice
is visible in the path helpers: **[src]**

```ts
// src/utils/stringToPath.ts (v7.84.0)
const FIELD_PATH_RE = /[.[\]'"]/;
export default (input: string): string[] => input.split(FIELD_PATH_RE).filter(Boolean);
```

```ts
// src/utils/set.ts (v7.84.0) — how an intermediate container is chosen
newValue = isObject(objValue) || Array.isArray(objValue)
  ? objValue
  : !isNaN(+tempPath[index + 1]) ? [] : {};
```

— <https://github.com/react-hook-form/react-hook-form/blob/v7.84.0/src/utils/stringToPath.ts>,
<https://github.com/react-hook-form/react-hook-form/blob/v7.84.0/src/utils/set.ts>

Reading those two together: a path segment only forces an **array** container when
`Number(segment)` is not `NaN`; and the only characters that split a path are
``. [ ] ' "``. A UUID contains hyphens, so `+uuid` is `NaN` (object container, not array),
and contains none of the splitting characters (stays one segment). **[src]**

Measured: registering `amounts.01924abc-1234-7abc-8def-0123456789ab` and
`amounts.0192dead-beef-7000-8000-abcdefabcdef` submits
`{ amounts: { "01924abc-…": 300, "0192dead-…": 700 } }`, a plain object, not an array.
**[obs]**

Two consequences worth carrying forward:

- The docs' "must not start with a number" rule is **stricter than the implementation**.
  Whether a member id starting with a digit is safe rests on `[src]` + `[obs]`, not on a
  documented guarantee. **[gap]**
- The path grammar is character-sensitive: an identifier containing `.`, `[`, `]`, `'` or
  `"` would be silently split into multiple segments. UUIDs never contain those; any
  future non-UUID member key would need re-checking. **[src]**

A related, already-fixed class of bug shows how sharp these edges are: `@hookform/resolvers`
5.5.8 fixed the zod resolver dropping errors for fields named `toString` / `hasOwnProperty`,
and its own test file records that fields named `__proto__`, `constructor` and `prototype`
**remain dropped end-to-end**, because RHF's `set`/`get` hard-code those as protected paths.
— <https://github.com/react-hook-form/resolvers/commit/2f28787> (test
`zod/src/__tests__/special-path-names.ts`), and `PROTOTYPE_KEYWORDS` in
<https://github.com/react-hook-form/react-hook-form/blob/v7.84.0/src/utils/set.ts> **[doc/src]**

### 1.3 TypeScript accepts a dynamic key — and accepts too much

`FieldPath<T>` is built by recursing over `keyof T`; for an index-signature `Record<string,
number>`, `keyof T` is `string`, so the generated path is the template literal
`` `amounts.${string}` ``.
— <https://github.com/react-hook-form/react-hook-form/blob/v7.84.0/src/types/path/eager.ts> **[src]**

Type-checked locally (`tsc --strict`) against `type FormValues = { total: number; amounts:
Record<string, number>; weights: Record<string, number> }`: **[obs]**

| Expression | Result |
| --- | --- |
| `register(\`amounts.${memberId}\`, { valueAsNumber: true })` | compiles |
| `const p: FieldPath<FormValues> = "amounts.anything.at.all"` | **compiles** — nonsense under the record is not caught |
| `const p: FieldPath<FormValues> = "amonuts.x"` | correctly rejected |
| `watch("amounts")` | typed `Record<string, number>` |
| `watch(\`amounts.${memberId}\`)` | typed `number` |
| `useWatch({ control, name: "amounts" })` | typed `Record<string, number>` |
| `errors.amounts?.[memberId]?.message` | typed `string \| undefined` |
| `errors.root?.message` | typed `string \| undefined` |

So `Record`-shaped `watch` works at both type and value level, but the template-literal
path type gives up path-typo protection **below** the record key.

### 1.4 `useFieldArray` is index-shaped and does not fit a Record directly

- `name` — "**Note:** Dynamic names are not supported." **[doc]**
- "`useFieldArray` automatically generates a unique identifier named `id` which is used for
  the `key` prop… The `field.id` (and not `index`) must be added as the component key". **[doc]**
- "**Does not support flat field arrays.**" (v7) **[doc]**
- "`shouldUnregister: true` is not supported. Field array relies on inputs being mounted and
  unmounted to manage its internal state — enabling `shouldUnregister` causes newly added
  fields to be unregistered on re-render, so their values are lost." **[doc]**

— <https://react-hook-form.com/docs/usefieldarray>

Registration inside a field array is by **index** (`test.${index}.value`), so a "field array
+ parallel id array" arrangement means the form value becomes an array of
`{ memberId, amount }` rows rather than a `Record`, and the payload has to be re-keyed into
a `Record` before it reaches `buildSplitRule` / the API. The docs describe no way to key a
field array by a domain identifier. **[doc]** Whether that re-keying is preferable to flat
dotted paths is a judgement this ticket does not make.

RHF v8 (beta) claims "V8 supports flat field arrays" and renames `field.id` → `field.key`.
— <https://github.com/react-hook-form/documentation/blob/master/src/content/migrate-v7-to-v8.mdx> **[doc]**
Whether "flat field array" means anything for `Record`-keyed data is **not stated**. **[gap]**

### 1.5 What happens to a value when its participant is unchecked

Documented behavior, `useForm({ shouldUnregister })`, default `false`:

> By default, an input value will be retained when an input is removed. However, you can
> set `shouldUnregister` to `true` to `unregister` the input during unmount.
>
> - This is a global configuration that overrides child-level configurations. To have
>   individual behavior, set the configuration at the component or hook level…
> - By default, `shouldUnregister: false` means unmounted fields are **not validated** by
>   built-in validation.
> - By setting `shouldUnregister` to true at `useForm` level, `defaultValues` will **not**
>   be merged against submission result.
> - Setting `shouldUnregister: true` makes your form behave more closely to native forms…
>   Unmounting an input removes its value.

— <https://react-hook-form.com/docs/useform#shouldUnregister> **[doc]**

And from the `register` rules: "Input values and references are not automatically removed on
unmount. Use `unregister` to explicitly remove them when needed." **[doc]**

`shouldUnregister` also exists per-`register` call
(`register(name, { shouldUnregister: true })`), described identically: "Input will be
unregistered after unmount and `defaultValues` will be removed as well." **[doc]**

Measured with two participants, entering 300 and 700, then unmounting the second input: **[obs]**

| Config | `getValues().amounts` after unmount | submitted `amounts` |
| --- | --- | --- |
| default (`shouldUnregister: false`) | `{A: 300, B: 700}` | `{A: 300, B: 700}` |
| `useForm({ shouldUnregister: true })` | `{A: 300}` | `{A: 300}` |

So **yes, `shouldUnregister` is the lever**, and yes, by default a de-selected participant's
amount stays in the form values and in the submitted payload. That matters for a
`z.record(...)`-based schema, which validates *every* key present — including a stale one
belonging to someone no longer participating. The current hand-rolled `pick()` in
`web/lib/split.ts` sidesteps this by reading only the participants array.

Caveats the docs attach to `shouldUnregister: true`: it is global and overrides child-level
config; `defaultValues` are no longer merged into the submission result; and the unmount must
be observable to RHF — the docs' own example shows a child component that toggles an input
purely from local `useState` "❌ won't get notified; you need to invoke `unregister`", while
a toggle driven from `useForm`/`useWatch` state "✅ gets notified". **[doc]**

`unregister(name, options)` is the explicit alternative, with `keepDirty`, `keepTouched`,
`keepIsValid`, `keepError`, `keepValue`, `keepDefaultValue` flags, and the documented rule
that "By `unregister` an input, it will not affect the schema validation."
— <https://react-hook-form.com/docs/useform/unregister> **[doc]**

Not established: whether a **stale error** at `errors.amounts[<removed id>]` is cleared when
that field unmounts under the default `shouldUnregister: false`. **[gap]**

---

## 2. Cross-field validation via `@hookform/resolvers/zod`

### 2.1 Whole-object refinements are expressed with `.refine` / `.superRefine` / `.check`

zod's own docs: **[doc]**

- `.refine()` — "To customize the error path, use the `path` parameter. This is typically
  only useful in the context of object schemas", with the canonical
  `path: ["confirm"]` password example.
- `.superRefine()` — "The regular `.refine` API only generates a single issue with a
  `"custom"` error code, but `.superRefine()` makes it possible to create multiple issues
  using any of Zod's internal issue types", via `ctx.addIssue({...})`.
- `.check()` — "a more low-level API that's generally more complex than `.superRefine()`".

— <https://zod.dev/api> (source:
[`packages/docs/content/api.mdx`](https://github.com/colinhacks/zod/blob/main/packages/docs/content/api.mdx))

The docs' `.superRefine` example does not pass `path`, but the type does allow it: the
`addIssue` argument is `MakePartial<$ZodIssue, "message" | "path">`, i.e. `path` is an
optional field of a full raw issue.
— <https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/api.ts> (`_superRefine`,
`$ZodSuperRefineIssue`) **[src]**

For a refinement attached at the **root** object, the path you pass is the path relative to
the root: nested issue paths are prefixed on the way up by `util.prefixIssues`, which is
only invoked when a parent schema propagates a child's issues.
— <https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/util.ts> **[src]**

### 2.2 A refinement error *can* be attached to a specific participant's field

The zod resolver flattens each issue with `path.join('.')` and then re-nests it with RHF's
own `set`:

```ts
// zod/src/zod.ts (v5.6.0)
const { code, message, path } = error;
const _path = path.join('.');
…
errors[_path] = { message, type: code };
```

```ts
// src/toNestErrors.ts (v5.6.0)
for (const path in errors) { … set(fieldErrors, path, error); }
```

— <https://github.com/react-hook-form/resolvers/blob/v5.6.0/zod/src/zod.ts>,
<https://github.com/react-hook-form/resolvers/blob/v5.6.0/src/toNestErrors.ts> **[src]**

So `ctx.addIssue({ code: "custom", message, path: ["amounts", memberId] })` becomes the flat
key `amounts.<memberId>` and then `errors.amounts[<memberId>]`. RHF's own resolver docs
describe this contract from the other side: **[doc]**

> The keys of the `errors` object should match the `name` values of your fields, but they
> _must_ be hierarchical rather than a single key for deep errors: ❌
> `{ "participants.1.name": someErr }` will not set or clear properly - instead, use ✅
> `{ participants: [null, { name: someErr } ] }` … you can still prepare your errors using
> flat keys, and then use a function like this one from the zod resolver:
> `toNestErrors(flatErrs, resolverOptions)`

— <https://react-hook-form.com/docs/useform#resolver>

Measured end-to-end (`total: 1000`, amounts 300 + 600, root `superRefine` raising
`path: ["amounts", A]`): **[obs]**

```json
{ "amounts": { "01924abc-1234-7abc-8def-0123456789ab": {
    "message": "amounts sum to 900, total is 1000", "type": "custom", "ref": "[ref]" } } }
```

Note the same RHF resolver doc carries a caveat about parent-level errors: "Schema
validation focuses on field-level error reporting. Parent-level error checking is limited to
the direct parent level, which is applicable for components such as group checkboxes." **[doc]**
What that means for an error deliberately attached at `amounts` (the whole subtree) rather
than `amounts.<id>` is not spelled out. **[gap]**

### 2.3 A form-level ("root") error from the resolver is deleted on submit

This one is a trap. The zod resolver **does** produce a `root` error — verified by calling
the resolver directly with issues at `["root"]`, `["root","split"]`, and no path: **[obs]**

```json
{ "values": {}, "errors": {
  "root":   { "message": "via root", "type": "custom",
              "split": { "message": "via root.split", "type": "custom" } },
  "":       { "message": "no path", "type": "custom" },
  "amounts": { "01924abc-…": { "message": "via amounts.A", "type": "custom" } } } }
```

But driving the same schema through `useForm` + `handleSubmit`, `formState.errors` came back
as `{ "": { message: "form level, no path", … } }` — **the `root` and `root.split` entries
were gone**, and the pathless issue landed under the empty-string key. **[obs]**

The cause is in RHF's `handleSubmit`, which unconditionally clears `root` after running the
resolver:

```js
unset(_formState.errors, ROOT_ERROR_TYPE);   // ROOT_ERROR_TYPE === 'root'
if (isEmptyObject(_formState.errors)) { … }
```

— `dist/index.esm.mjs` of `react-hook-form@7.84.0`, line ~3055 **[src]**

That is consistent with the documented role of `root`: "You can set a server or global error
with `root` as the key. This type of error will not persist with each submission."
— <https://react-hook-form.com/docs/useform/seterror> **[doc]** — but the docs describe it
for `setError`, and say nothing about a resolver-produced `root` error being discarded. **[gap]**

Practical reading: a schema-level "the split doesn't add up" message has to be attached to a
real field path (e.g. `amounts.<someId>`, or `total`) to survive submit; an issue with **no**
path lands at the untyped key `errors[""]`; `errors.root` is reachable only via `setError`
after the fact. Whether an issue at some other synthetic path (e.g. `path: ["splitRule"]`
with a matching registered-but-hidden field) is a workable channel was not tested. **[gap]**

### 2.4 Validating against `total`, which lives outside the split subtree

Mechanically this is free: the refinement receives the **whole form object**, so
`v.amounts` and `v.total` are both in scope; there is no need for `total` to live inside the
split subtree. `useForm`'s `context` option is the documented channel for anything genuinely
*outside* the form ("This context `object` is mutable and will be injected into the
`resolver`'s second argument"). — <https://react-hook-form.com/docs/useform#context> **[doc]**

The real constraint is *when* the refinement runs. zod: **[doc]**

> By default, refinements don't run if any *non-continuable* issues have already been
> encountered. Zod is careful to ensure the type signature of the value is correct before
> passing it into any refinement functions.

with the worked example of an unrelated `anotherField: 1234` blocking a password check, and
the `when` parameter as the escape hatch. — <https://zod.dev/api> (`#when`)

Measured which failures actually suppress a root `superRefine` on
`z.object({ total: z.number().int().positive(), amounts: z.record(z.string(), z.number().int().nonnegative()) })`: **[obs]**

| Input | Refinement ran? | Issues produced |
| --- | --- | --- |
| `total: NaN` | **no** | `invalid_type@total` only |
| `total: undefined` (key missing) | **no** | `invalid_type@total` only |
| `total: 10.5` (fails `.int()`) | **no** | `invalid_type@total` only |
| `total: 0` (fails `.positive()`) | **yes** | `too_small@total` **and** the sum error |
| `amounts[A]: NaN` | **no** | `invalid_type@amounts.A` only |
| unrelated `memo` too short (`too_small`) | **yes** | both |

The rule this exposes is sharper than the docs' prose: it is specifically the
**non-continuable** issues (`invalid_type`, which `.int()` also emits) that suppress the
refinement; ordinary constraint failures (`too_small`) do not. **[obs]** The docs state the
"non-continuable" rule but do not enumerate which codes are non-continuable. **[gap]**

Why this matters concretely for the add-expense form: an empty numeric input registered with
`valueAsNumber: true` yields `NaN` **[doc]** ("Returns `Number` normally. If something goes
wrong `NaN` will be returned"), which is an `invalid_type` — so while `total` is blank or a
participant's amount is blank, the sum/percentage check does **not** run at all, and the user
sees zod's type message instead of a domain message. `web/lib/split.ts` currently handles
that case explicitly ("fill in a value for every participant", "total amount required").

`when` is the documented lever for the *unrelated-field* case, and a `when`-guarded
refinement behaved identically to the plain one in the tested unrelated-field scenario
(both ran). **[obs]** `when` cannot rescue the case where the refinement's *own* inputs are
the invalid ones — that is inherent, not a library limitation.

### 2.5 Alternatives visible in the docs, for completeness

- `useForm({ validate })` — a form-level validate API is documented on the `useForm` page,
  receiving the whole form object and returning "a structured error that integrates with
  `formState.errors`". — <https://react-hook-form.com/docs/useform> **[doc]** Its interaction
  with `resolver` is not described. **[gap]**
- `register(name, { deps })` — "Validation will be triggered for the dependent inputs, it is
  only limited to the register API, not trigger." **[doc]** Note: "A resolver cannot be used
  with the built-in validators". **[doc]**
- `setError` — can attach errors to any path after the fact, but "will not persist the
  associated input error if the input passes `register`'s associated rules", and requires an
  explicit `type` when setting on nested fields or a later parent-path `setError` overwrites
  the child. — <https://react-hook-form.com/docs/useform/seterror> **[doc]**

---

## 3. React 19.2 / Next 16.2 compatibility

### 3.1 Peer range and stated support

`react-hook-form@7.84.0` declares `peerDependencies: { react: "^16.8.0 || ^17 || ^18 || ^19" }`
— published package metadata (`npm view react-hook-form peerDependencies`). React 19 support
was added deliberately: release v7.52.0 (2024-06-15) lists "close #11932 enable react 19 peer
dependency (#11935)". — <https://github.com/react-hook-form/react-hook-form/releases> **[doc]**

`@hookform/resolvers@5.6.0` declares `react-hook-form: ^7.55.0` as a **required** peer (every
validation library, including `zod`, is `peerDependenciesMeta.optional`). **[doc]**

React 19.2's release notes list `<Activity />`, `useEffectEvent`, `cacheSignal`, Performance
Tracks and Partial Pre-rendering, plus a `useId` prefix change (`:r:`/`«r»` → `_r_`) and
`eslint-plugin-react-hooks` flat config; nothing specific to third-party form libraries,
refs or controlled inputs. — <https://react.dev/blog/2025/10/01/react-19-2> **[doc]**

### 3.2 `"use client"` boundary

`react-hook-form@7.84.0` ships **no `"use client"` directive** in its dist bundles (grepped
the published tarball; the string appears nowhere in `dist/`). **[obs]** Consequently the
consumer must declare the boundary — which `web/app/g/[groupId]/add/page.tsx` already does.

The package does declare a `react-server` export condition: **[src]**

```json
"exports": { ".": { "types": "./dist/index.d.ts",
                    "react-server": "./dist/react-server.esm.mjs",
                    "import": "./dist/index.esm.mjs",
                    "require": "./dist/index.cjs.js" } },
"sideEffects": false
```

and that server build exports only `{ appendErrors, createFormControl, get, set }` — no
hooks. **[obs]** It was added in v7.49.0 ("feat: add react-server bundle (#11162)").
— <https://github.com/react-hook-form/react-hook-form/releases/tag/v7.49.0> **[doc]**

Reading: importing `react-hook-form` from a Server Component resolves to a hookless build, so
`useForm` is simply not available there — an import-time/type failure rather than a confusing
runtime one. The docs do not describe this bundle or its intended use. **[gap]**

### 3.3 React Compiler — the substantive risk, and it is currently inert here

Next.js 16: **[doc]**

> Built-in support for the React Compiler is now stable in Next.js 16 following the React
> Compiler's 1.0 release… The `reactCompiler` configuration option has been promoted from
> `experimental` to stable. **It is not enabled by default** as we continue gathering build
> performance data across different application types.

— <https://nextjs.org/blog/next-16>

`web/next.config.ts` in this repo sets no options at all, so the compiler is off. **[obs]**

RHF v7 and the React Compiler have a long-running, still-open incompatibility tracked in the
library's own repo: issue #12298, "Correct behaviour for apps using react-compiler", opened
2024-10-03, **still open**. Notable statements in that thread: the reporter found 35 failing
tests in RHF's own suite when compiled, and wrote "The reported issues may be around `watch`
but as you can see from the unit tests there are wider issues with `getFieldState`, nested
inputs, `reset` etc. I wouldn't recommend compiling any form using rhf." The maintainer's
reply: "I think at the moment, most of the issue is around the `watch` API, perhaps leave a
note in the doc to highlight with react compiler to start with."
— <https://github.com/react-hook-form/react-hook-form/issues/12298> **[doc — issue tracker, not documentation]**

Related closed reports: #12598 (`watch()` does not update with react-compiler), #12618
(`useFormContext` doesn't re-render), #13095 (field errors not cleared, workaround
`'use no memo'`), #13505 (v8 alpha: `formState.errors` change doesn't re-render children).

RHF's v7→v8 migration doc says: "V8 adds first-class support for the
[React Compiler](https://react.dev/learn/react-compiler). No additional configuration is
required — React Hook Form is now compatible out of the box."
— <https://github.com/react-hook-form/documentation/blob/master/src/content/migrate-v7-to-v8.mdx> **[doc]**
No equivalent statement exists for v7. v8 is at `8.0.0-beta.3` (2026-07-10) with breaking
changes (register passes the real ref; `field.id` → `field.key`; `keyName` removed; `watch`
callback API removed in favour of `subscribe`; `setValue` no longer updates field arrays).

Note the repo already has `eslint-plugin-react-hooks@^7.1.1` in `web/devDependencies`, whose
modern rule set surfaces compiler-style "rules of React" violations even without the compiler
enabled. Whether it flags RHF usage patterns in this codebase was not tested. **[gap]**

---

## 4. Bundle cost

RHF's own README claims only "Small size and no dependencies" and links to bundlephobia; it
publishes no number. — <https://github.com/react-hook-form/react-hook-form/blob/v7.84.0/README.md> **[doc]**

Measured locally by bundling with esbuild (`--bundle --minify --format=esm --external:react
--define:process.env.NODE_ENV='"production"'`) and compressing the output: **[obs]**

| Entry | minified | gzip -9 | brotli -q11 |
| --- | --- | --- | --- |
| `import { useForm } from "react-hook-form"` | 27.6 KB | **10.3 KB** | 9.5 KB |
| …plus `import { zodResolver } from "@hookform/resolvers/zod"` | 31.0 KB | **11.4 KB** | 10.4 KB |
| `import { z } from "zod"` (already a dependency) | 327 KB | 64.6 KB | 53.9 KB |

So against the current dependency set: **≈10.3 KB gzip for RHF, and ≈1.1 KB gzip more for the
zod resolver** — the resolver is thin because it delegates to `zod` and to RHF's own
`get`/`set`. `@hookform/resolvers` declares exactly one real dependency,
`@standard-schema/utils`, and lists every validation library as an *optional* peer (since
v5.4.1, "declare validation libraries as optional peerDependencies"), so importing only
`@hookform/resolvers/zod` pulls in no other validator. **[doc/src]**

zod is **already in the client bundle** on this route: `web/lib/api.ts` imports from
`./api-schemas/zod.gen`, and the add-expense page imports `addEntry` from `@/lib/api`. **[obs]**
The 64.6 KB row above is therefore existing cost, not new cost — though how much of zod
survives tree-shaking in the real Turbopack build was not measured. **[gap]**

`react-hook-form` declares `"sideEffects": false` and has **zero** runtime dependencies. **[src]**

---

## 5. Does the current resolver support zod v4?

**Yes — explicitly, and this is documented, not inferred.**

- `@hookform/resolvers@5.6.0` declares the optional peer
  `zod: "^3.25.0 || ^4.0.0"`. — published package metadata **[doc]**
- Release **v5.1.0** (2025-06-07): "support Zod 4, Zod v4 mini, and retains compatibility with
  Zod v3 (#777)". — <https://github.com/react-hook-form/resolvers/releases> **[doc]**
- The README's zod section shows `import { z } from 'zod'; // or 'zod/v4'`.
  — <https://github.com/react-hook-form/resolvers/blob/v5.6.0/README.md> **[doc]**

The implementation branches on the schema instance at runtime, with a dedicated zod-4 issue
parser: **[src]**

```ts
const isZod4Schema = (schema: any): schema is z4.$ZodType =>
  '_zod' in schema && typeof schema._zod === 'object';
const isZod4Error = (error: any): error is z4.$ZodError =>
  !!error?._zod?.traits?.has('$ZodError');
// Zod 4 is checked first: its `_zod` marker is unambiguous …
```

— <https://github.com/react-hook-form/resolvers/blob/v5.6.0/zod/src/zod.ts>

Zod-4-specific fixes have kept landing recently, which is evidence both of active support and
of ongoing rough edges: v5.2.1 (zod v4 mini discriminated union), v5.2.2 (zod 4 output type),
v5.5.1 (nested discriminated unions), v5.5.2 (zod v4 locale/global error customization not
picked up), v5.5.8 (special root field names). — release list, same URL. **[doc]**

Everything in §2 above was exercised against `zod@4.4.3` + `@hookform/resolvers@5.6.0` and
worked. **[obs]**

One typing caveat the README calls out, relevant because generated schemas may use defaults:
a field with `.default(...)` is optional on `z.input` but required on `z.output`, and
"Passing a single generic to `useForm<T>` pins both to the same type and will conflict with
`zodResolver`" — either omit the generic or specify all three
(`useForm<z.input<typeof s>, unknown, z.output<typeof s>>`). **[doc]**

---

## Unknowns / could not establish from sources

1. **`Record`-shaped subtrees are not a documented concept in RHF.** The docs describe field
   *paths*; the fact that a non-numeric dynamic segment yields an object key is read off
   `set.ts`/`stringToPath.ts` and confirmed by running it, not promised anywhere.
2. **The docs say names "must not start with a number"; UUIDv7 keys do.** The implementation
   only special-cases *fully numeric* segments. This is a documented-rule-vs-observed-behavior
   conflict; it works today but is not covered by a guarantee.
3. **Stale errors on unmount.** Whether `errors.amounts[<removed participant>]` is cleared
   when that input unmounts under the default `shouldUnregister: false` was not tested and is
   not stated. Values are documented to be retained; errors are not discussed.
4. **A resolver-produced `root` error is discarded by `handleSubmit`.** Established from
   `[src]` + `[obs]`; the docs describe `root` only in the `setError` context and never say a
   resolver cannot use it. Whether this is intended or incidental is unknown.
5. **Pathless issues land at `errors[""]`.** Observed; entirely undocumented; not reachable
   through RHF's `FieldErrors` typing in any documented way. Do not rely on it.
6. **Which zod issue codes are non-continuable** is not enumerated in the docs. The table in
   §2.4 is empirical for the codes tested only.
7. **"Parent-level error checking is limited to the direct parent level"** — the resolver docs
   state this but do not define it. The behavior of an error attached at `amounts` (the whole
   subtree) rather than `amounts.<id>` was not tested.
8. **`useForm({ validate })` vs `resolver`.** The form-level `validate` option is documented,
   but its interaction with a `resolver` (which wins, whether both run) is not.
9. **React Compiler + RHF v7 in *this* app.** The compiler is off in `web/next.config.ts`, so
   nothing was measured. RHF's own tracker says v7 has known compiler problems and its v8
   beta claims to fix them; no primary source states what breaks specifically for the
   `register` + `formState.errors` pattern in question.
10. **`eslint-plugin-react-hooks@7` against RHF usage.** Not run.
11. **Real-world Turbopack bundle delta.** The esbuild figures in §4 are a clean-room proxy;
    no production `next build` was performed, and zod's tree-shaken footprint in the current
    app was not measured.
12. **RHF v8 "flat field arrays".** The migration doc names the feature without defining it;
    whether it addresses identifier-keyed data is unknown, and v8 is beta.

---

## Appendix: how the `[obs]` facts were produced

Reproducible outside this repo — nothing was installed into `web/`. In a scratch directory:

```bash
npm i react-hook-form@7.84.0 @hookform/resolvers@5.6.0 zod@4.4.3 \
      react@19.2.4 react-dom@19.2.4 \
      @testing-library/react vitest jsdom typescript esbuild
```

- **Behavioral probes**: Vitest + jsdom + `@testing-library/react`, rendering small forms that
  `register("amounts.<uuidv7>")`, toggle an input's mount state, and submit through
  `handleSubmit` with `zodResolver`. Error objects were dumped from `formState.errors`, and in
  one case the resolver was invoked directly (`zodResolver(schema)(values, undefined, {fields:
  {}, names: [], criteriaMode: 'firstError', shouldUseNativeValidation: false})`) to separate
  resolver behavior from `useForm` behavior.
- **zod continuable/non-continuable table**: plain `schema.safeParse(input)` calls, no React.
- **Type checks**: `tsc --noEmit --strict --jsx react-jsx --moduleResolution bundler`
  (TypeScript 7.0.2 was what the scratch install resolved; `web/` pins `typescript@^5`, so the
  path-type results should be re-confirmed under TS 5 if they end up load-bearing).
- **Bundle sizes**: `esbuild --bundle --minify --format=esm --platform=browser
  --external:react --define:process.env.NODE_ENV='"production"'`, then `gzip -9` / `brotli -q 11`.
- **`"use client"` / exports / `react-server` bundle**: inspected the published tarballs via
  `npm pack`.
