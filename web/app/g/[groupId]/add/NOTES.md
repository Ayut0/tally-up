# #141 prototype notes — does RHF earn its place in add-expense?

## Question

Does React Hook Form earn its place in the add-expense form's split-mode
section (dynamic per-participant `amounts`/`weights`, cross-field
sum/percent validation) — or does extracting a tested hook already capture
the win?

## Method

Built the split-mode section both ways, mounted side by side on the real
`/g/[groupId]/add` route behind a `?variant=` switcher
(`SplitSectionPrototype.prototype.tsx`), fed by the same live
`participantIds` (from the real participant checklist) and `total` (from the
real total input) — so toggling a participant or typing a total exercises
both variants identically. Verified interactively (Playwright driving a
real Chromium against `make db-up` + `go run ./cmd/api` + `npm run dev`,
a 3-member group), not just read off the code.

## Verdict: No — RHF does not earn its place here

**Line count**: `SplitSectionAsIs.prototype.tsx` is 117 lines total
(markup + state + wiring). The RHF path needs `SplitSectionRhf.prototype.tsx`
(148 lines) **plus** a new `rhfSplitSchema.prototype.ts` (126 lines) — 274
lines, and the schema file exists solely to re-encode rules
`web/lib/split.ts`'s `buildSplitRule` already expresses and already keeps in
lockstep with the Go domain engine (transcribed test cases, per that file's
own comment). Adopting RHF here doesn't remove that validation logic — it
adds a third representation of it (Go engine, `lib/split.ts`, zod schema)
where today there are two, with a new place for the three to drift apart.

**A real bug surfaced by building this, not just reading about it**: the
first schema draft required both `amounts` and `weights` to be well-typed
unconditionally. RHF's default `shouldUnregister: false` means switching
from Exact to Percent mode leaves a stale `NaN` sitting in the unmounted
`amounts` field — and that stale value failed the *other* mode's validation
too, since a non-continuable `invalid_type` at the base-shape level
suppresses `superRefine` entirely (same mechanism #139 §2.4 measured for an
empty field, triggered here by a mode switch instead). Fix: scope the base
shape per mode, matching `buildSplitRule`'s switch statement, which never
even reads the inactive record. `buildSplitRule` gets this for free from its
control flow; the RHF version needed a second design pass to notice and fix
it.

**Error-message fidelity regressed**: an untouched/empty required field is
`NaN`, which is a zod `invalid_type` — non-continuable, so it never reaches
the `superRefine` that would say "fill in a value for every participant".
The user sees zod's generic "Invalid input: expected number, received NaN"
instead. Confirmed live, both before and after the mode-scoping fix. Closing
this gap costs real additional work (a custom zod error map, or loosening
the field type to string and coercing inside `superRefine`) that a
hand-rolled `useState` + `buildSplitRule` never has to do, since it just
returns the domain message unconditionally.

**Participant toggling**: parity, but not a point in RHF's favor. Neither
implementation clears a de-selected participant's value — confirmed live
(toggle off Carol, retype nothing, toggle back on: both variants show her
stale value, both variants' *validation* correctly ignores her while
unchecked). The hand-rolled version gets this by construction (`pick()` only
reads `participantIds`); the RHF version needed the schema to be written the
same way — `shouldUnregister`/`unregister` (the levers #139 flagged) turned
out unnecessary, but only because of that deliberate scoping, not because
RHF handles it automatically.

**Live preview**: parity, achieved via `useWatch` + the same
`buildSplitRule`/`previewShares` calls the hand-rolled version already
makes. No win, no loss — RHF's uncontrolled-by-default model gets no credit
here since the preview needs every keystroke regardless.

**Error timing**: parity, but required `mode: "onChange"` plus an explicit
`useEffect` re-`trigger()` on schema change (the zod resolver closes over
the schema instance at the moment `useForm` is called; RHF has no way to
know a *new* schema should replace it). RHF's out-of-the-box default
(validate-on-submit) would have been a UX regression from today's immediate
error display.

**Not exercised**: bundle cost (+10.3 KB gzip RHF, +1.1 KB resolver, per
#139) — real, but not the deciding factor next to the code-volume and
correctness findings above.

## Why

The split-mode section's actual complexity is domain validation that
already exists, is already tested, and is deliberately kept in lockstep with
the Go engine. RHF's value proposition (less state plumbing, declarative
validation) doesn't materialize when the validation itself has to be
re-expressed in a second schema language rather than reused directly — and
every parity point it does reach (toggling, live preview, error timing)
required matching, non-default configuration to get back to where the
hand-rolled version already stood by default. #158's tested-hook extraction
is the answer to #131's original question, not RHF.

## Disposition

Verdict posted to #141 and folded into #137's "Decisions so far". Prototype
files (`*.prototype.tsx`, `*.prototype.ts`, `PrototypeVariantSwitcher.tsx`,
this file) and the `react-hook-form`/`@hookform/resolvers` dependencies are
being removed from `web/package.json` — nothing here ships.
