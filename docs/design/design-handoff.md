# Handoff: tally-up — Bill Splitter Mobile UI

## Overview
tally-up is a link-based, accountless bill splitter for friend groups (trips, dinners, gatherings — n people, not just two). One person creates a group, shares the URL, and everyone picks their name once. Expenses are logged as they happen and balances are always recomputed fresh from the expense log — never hand-adjusted. This handoff covers the four core screens plus all four expense-split modes and an empty state.

## About the Design Files
The bundled file `Tally-up Mockups.dc.html` is a **design reference built in HTML** — static, high-fidelity mockups showing the intended look, layout, and copy. It is not production code and should not be copied as-is. Your task is to **recreate these designs in the target codebase's existing environment** (React Native, SwiftUI, Android/Compose, web, etc.) using its established component patterns, or — if no environment exists yet — pick the framework best suited to a shareable, no-install, link-based web app (a plain responsive web app is a natural fit given "no accounts, no app-store install").

Open the file directly in a browser to view all screens side by side (a canvas of labeled panels, each 390px wide).

## Fidelity
**High-fidelity.** Colors, type, spacing, and copy shown are final-intent, not placeholders. Recreate pixel-close using the target codebase's component library/tokens where one exists.

## Product behavior (source of truth)
See `product-spec.md` for the full original product spec (flow, fixed vs. open decisions, behavioral notes). Key rules that must survive implementation:
- Balances are **always computed fresh** from the expense log — never manually edited.
- Whole yen only — no decimals, anywhere.
- Corrections are struck-through, never deleted from the log.
- One thumb-reachable primary action per screen.
- 390px mobile baseline; must work one-handed.
- Home screen (Balances & history) auto-refreshes ~every 5 seconds.
- Whoever is listed first at group creation becomes "you" — no separate signup.
- A member's device-local choice on Screen 02 is remembered — returning members skip straight to Screen 03.

## Screens / Views

### 1. Create a group (`#1a`)
**Purpose:** Group creator names the group and lists members (the only page with a plain, non-invite URL).
**Layout:** Single column, 26px horizontal padding, 24px gap between sections. Card is 390px wide.
- Wordmark row: 4-bar "tally mark" icon (4 vertical bars, 3px wide × 20px tall, `#b4562e`, plus a diagonal strike bar) + "tally-up" wordmark, Karla 800 26px, `#2b2118`, letter-spacing -0.02em.
- Subhead line, Karla 500 14.5px, `rgba(43,33,24,.6)`.
- "Group name" label (Karla 700 12px uppercase, letter-spacing .06em, `rgba(43,33,24,.55)`) + text field (white bg, 1.5px `rgba(43,33,24,.18)` border, 12px radius, 14×16px padding, value in Karla 600 17px `#2b2118`).
- "Members — put yourself first" label, then one row per member: white card, same border/radius as above, 12×14px padding, flex row with 30px circular avatar (initial, Karla 800 13px, background a pastel oklch hue per person) + name (Karla 600 16px) + a "YOU" pill badge (only on first row: `#f3e7c9` bg, `#8a5a1d` text, Karla 700 10.5px, pill radius).
- "+ add member" button: dashed 1.5px border `rgba(43,33,24,.3)`, transparent bg, 12px radius, Karla 700 14px `rgba(43,33,24,.6)`.
- Primary button "Create group": full width, `#b4562e` bg, white Karla 800 17px text, 14px radius, 17px vertical padding, bottom offset shadow `0 3px 0 #8f3f1d` (pressed-button effect), min-height 52px.

### 2. Open the shared link (`#1b`)
**Purpose:** First-time join — pick your name from the roster. Shown once per person per device.
**Layout:** Single column, 26px padding, top-loaded content (44px top padding).
- Eyebrow: "You're invited", Karla 700 12px uppercase, letter-spacing .1em, color `#b4562e`.
- Group name heading: Karla 800 30px, `#2b2118`, letter-spacing -0.02em.
- Instruction line: Karla 600 16px, `rgba(43,33,24,.65)`.
- One large tappable row per member, 12px gap between rows: white bg, 1.5px `rgba(43,33,24,.18)` border (hover → `#b4562e`), 16px radius, 18px padding, min-height 64px. Row = 38px avatar circle + name (Karla 700 18px) + trailing chevron (`rgba(43,33,24,.35)`).
- Footer note for anyone not listed, centered, Karla 500 12.5px `rgba(43,33,24,.45)`.

### 3. Balances & history (home) (`#1c`)
**Purpose:** The screen people return to most; read-only except for the single "Add expense" action.
**Layout:** Relative-positioned column, 22px horizontal padding, 32px top / 96px bottom (room for the floating button), 22px gap between sections.
- Header row: group name (Karla 800 24px) + "N members · updates live" caption (Karla 600 12px, `rgba(43,33,24,.5)`) on the left; small tally-mark icon on the right.
- **Balances** section, uppercase label, then a single white card (16px radius, 1.5px `rgba(43,33,24,.12)` border) containing one row per member separated by 1px hairlines: 32px avatar + name (Karla 700 16px; "(you)" suffix in Karla 600 12px, `rgba(43,33,24,.45)`) + signed amount, right-aligned, Karla/mono (Spline Sans Mono) 700 17px, tabular-nums.
  - **Positive balance color:** `oklch(0.52 0.12 150)` (green) — "in the black."
  - **Negative balance color:** `oklch(0.52 0.14 25)` (red) — "in the red."
  - The most-recently-updated row gets a brief highlight pulse (background flashes `#f3e7c9` → transparent, ~1.6s ease-out) when a new expense changes it.
- **History** section, uppercase label, then a vertical stack of white cards (14px radius, 1.5px border), 8px gap: memo (Karla 700 15px) + "who paid · when" caption (Karla 500 12px, `rgba(43,33,24,.5)`) on the left, amount (mono 700 15.5px, tabular-nums) on the right.
  - Deleted/corrected entries: same row but dashed border, translucent bg (`rgba(255,255,255,.5)`), memo and amount both strikethrough and dimmed (`rgba(43,33,24,.4)` / `.35`), caption reads "deleted — the ledger never forgets." **Never remove the row from the list.**
- Invite banner: `#f3e7c9` bg, 14px radius, 13×16px padding, copy text (Karla 600 13px, `#6d4a12`) + a real "Copy link" button (dark `#2b2118` bg, white text, 10px radius) — this is the entire invite mechanism, must be a tappable affordance, not just static text.
- Floating primary button "+ Add expense": pinned bottom (22px inset), full width, `#b4562e` bg, white Karla 800 17px, 16px radius, drop shadow + bottom offset shadow, min-height 56px.

### 4. Add an expense (`#1d`, plus split-mode variants `#1e` `#1f` `#1g`)
**Purpose:** Log one expense per submission — total, payer, participants, split method, memo, date.
**Layout:** Single column, 22px horizontal padding, 20px gap.
- Back button (36px circle, white, 1.5px border) + "Add expense" heading (Karla 800 22px).
- **Total** field: label, then a bordered (`#b4562e` 1.5px, "focused" treatment) white box with ¥ symbol (mono 700 20px, dimmed) + amount (mono 700 30px, `#2b2118`, tabular-nums). Helper caption: "Whole yen only — no decimals, ever." (Karla 500 11.5px, dimmed).
- **Paid by** field: label + single-select row (avatar + name + dropdown chevron), same white/border card style as elsewhere.
- **Who shared it?** field: label + wrapping row of pill toggles, one per member. Selected = filled `#2b2118` bg, white text, checkmark prefix. Deselecting removes someone from the split (their share reflows in Percent mode's UI — see `#1g`).
- **Split** field: 4-way segmented control (Equal / Exact / Shares / Percent) — light track `rgba(43,33,24,.08)`, active segment white with subtle shadow, Karla 800 13px active vs 700 13px `rgba(43,33,24,.5)` inactive.
  - **Equal** (`#1d`, default): no extra inputs. Live preview strip below the control: `#f3e7c9` bg, 12px radius, wrapping list of "Name ¥amount" in mono 600 13.5px, `#6d4a12`.
  - **Exact** (`#1e`): one row per member — name + a right-aligned ¥ input (mono 700 16px in a bordered box). Footer summary bar (`#f3e7c9`) shows running total vs. target with a ✓ once it matches: "Adds up ✓" / "¥8,000 / ¥8,000".
  - **Shares** (`#1f`): one row per member — name + a live-computed ¥ amount underneath (mono 600 12px, dimmed, prefixed "→") + a stepper (− / count / +, 38px square buttons, 10px radius). Footer bar shows total share count and confirms the yen total books exactly.
  - **Percent** (`#1g`): one row per member — name + live ¥ amount + a right-aligned "%" input (mono 700 16px). A deselected member (per "Who shared it?") shows as a dimmed, non-interactive row with an em-dash instead of a field. Footer bar confirms "100% ✓" and that yen books exactly (rounding remainders should be distributed, never dropped — see spec note 4 under Screen 04).
- **Memo** / **Date** fields: two-column grid, same bordered-white-box style; Memo Karla 600 14.5px with ellipsis overflow; Date in mono 600 14.5px.
- Primary button "Add": same styling as "Create group" button on Screen 1.

### Bonus: Empty state (`#1h`)
A brand-new group with zero expenses. Balances/History sections are replaced by a single dashed-border white card: dimmed 4-bar icon, "A fresh ledger" heading (Karla 800 17px), and explanatory copy ("Everyone starts at ¥0…"). Invite banner emphasizes outstanding invites ("3 friends haven't opened the link yet"). Floating "+ Add expense" button still present and primary.

## Interactions & Behavior
- Screen 1 → tapping "Create group" navigates straight to Screen 3 (no confirmation interstitial).
- Screen 2 → tapping a member row records the choice locally (localStorage/device-equivalent) and navigates to Screen 3; on repeat visits from the same device, Screen 2 is skipped entirely.
- Screen 3 polls/refreshes balances and history roughly every 5 seconds; a balance row that changed since the last refresh gets the pulse highlight described above.
- Screen 3 → "Copy link" writes the current group URL to the clipboard and should show a brief confirmation (toast/label swap), not a silent copy.
- Screen 3 → "+ Add expense" navigates to Screen 4.
- Screen 4 → the live preview / per-person amounts update on every keystroke/toggle change (total, payer, participant toggles, split mode, and per-mode inputs). Amounts must always be exact whole yen (rounding remainders assigned deterministically, e.g. to the first N people in list order) — the preview is a commitment, not an estimate.
- Screen 4 → toggling a participant off in "Who shared it?" removes them from all split-mode calculations immediately.
- Screen 4 → switching split-mode tabs preserves the total/payer/participants already entered.
- Deleting or correcting a history entry never removes the row — it re-renders struck through, permanently, in place.
- Hover state shown for tappable rows (Screen 2 join rows): border brightens to accent color `#b4562e`.

## State Management
Suggested state shape (adapt to target framework):
- `group`: `{ id, name, members: [{ id, name, colorHue }] }`
- `currentMemberId`: persisted per-device (localStorage/keychain-equivalent), set once on Screen 2, read on every subsequent load to route straight to Screen 3.
- `expenses`: append-only log — `{ id, memo, amountYen, paidBy, participants: [{ memberId, shareAmountYen }], splitMode, date, deletedAt?: timestamp }`. Corrections/deletions set `deletedAt`/a `correctedBy` pointer rather than mutating or removing the row.
- `balances`: **derived, not stored** — recompute from `expenses` on every read (sum paid − sum owed per member). This is the core trust guarantee of the product; never persist balances as an independent editable value.
- Screen 4 draft state: `{ totalYen, paidBy, participantIds[], splitMode, perPersonInputs (exact ¥ / share count / percent, mode-dependent), memo, date }`, computing a live `preview: { memberId: yen }` map on every change.

## Design Tokens

**Colors**
- Background (app canvas): `#ece5d8`
- Surface / cards: `#faf6ee` (mockup canvas bg) and `#ffffff` (input & row surfaces)
- Ink (primary text): `#2b2118`
- Ink, muted: `rgba(43,33,24,.45–.65)` depending on emphasis
- Accent (primary actions, links, focus): `#b4562e`, pressed/shadow tone `#8f3f1d`
- Highlight / banner: `#f3e7c9` bg, `#6d4a12` / `#8a5a1d` text
- Positive balance (in the black): `oklch(0.52 0.12 150)`
- Negative balance (in the red): `oklch(0.52 0.14 25)`
- Avatar pastels (one hue per member, rotate as needed): `oklch(0.85 0.06 60)`, `oklch(0.85 0.06 150)`, `oklch(0.85 0.06 250)`, `oklch(0.85 0.06 340)`, each paired with a darker same-hue-family text color.
- Borders (default): `rgba(43,33,24,.12–.2)`

**Typography**
- UI font: Karla (400/500/600/700/800)
- Numeric/monospace font (all ¥ figures, dates, counters): Spline Sans Mono (400–700)
- Section labels: 12px, 700 weight, uppercase, letter-spacing .06em
- Headings: 22–30px, 800 weight, letter-spacing -0.02em
- Body/captions: 12–16px, 500–600 weight

**Radius scale:** 9px (segmented control cells) / 10–12px (inputs, small buttons) / 14–16px (cards, primary buttons) / 22px (screen card container) / 99px (pills)

**Shadows:** primary buttons use a "pressed button" double shadow — soft ambient shadow + solid 3px offset in the darker accent shade (`0 3px 0 #8f3f1d`), not a blurred drop shadow.

## Assets
No photographic or icon assets — the wordmark uses a simple drawn "tally mark" glyph (4 bars + 1 diagonal strike), and avatars are initials on flat pastel-color circles. No external image assets to source.

## Files
- `Tally-up Mockups.dc.html` — all 8 screens/variants, viewable directly in a browser (labeled panels: `#1a` Create, `#1b` Join, `#1c` Balances/History, `#1d`–`#1g` Add expense + 3 split modes, `#1h` Empty state).
- `product-spec.md` — original product/behavior spec this design implements (flow, fixed constraints, open decisions).
