# tally-up — concept for design

*Concept for design handoff — not a final visual treatment. Structure, fields, and states below are fixed; color, type, iconography, and illustration are open for the designer to define.*

## What this app is

A bill splitter for friend groups — trips, dinners, gatherings. n people, not just two.

No accounts, no app-store install. Someone creates a group, shares the link, and everyone who opens it picks their own name from a list. Every expense — dinner, taxi, onsen tickets — gets logged with who paid and who shared it, and the app always knows exactly who owes whom.

The one promise that shapes everything downstream: **balances are always exactly right**, because they're computed fresh from a running log of every expense, never hand-adjusted. That's the personality worth carrying into the visual design — precise, trustworthy, a little bit like a well-kept ledger rather than a flashy fintech app.

## How to read this document

- **Plain field lists** = structure only. Layout, hierarchy, and states are fixed; color, type, and iconography are yours.
- **Numbered notes** = behavior that has to survive redesign — the "why," not just the "what."
- **Green / red** = the one semantic pair already load-bearing in the product (see Screen 03) — positive balance / negative balance.

## The flow, end to end

1. **Create** — name the group, list who's in it
2. **Share the link** — the URL itself is the invite
3. **Pick yourself** — everyone who opens it, once
4. **Add expenses** — as they happen, from any phone
5. **Watch balances** — updates live, for everyone
6. **Settle up** — fewest transfers to zero out

---

## Screen 01 — Create a group

*The only page with a plain URL.*

**Fields, top to bottom:**
- Wordmark: "tally-up"
- Group name (text) — e.g. `Kyoto Trip`
- "Members — put yourself first" label
- Member name fields, one per row — e.g. `Yuto (you)`, `Aya`, `Kenji`, `Mio`
- "+ add member" (adds another row, up to 20)
- Primary button: **Create group**

**Notes:**
1. Whoever is listed first becomes "you" the instant the group exists — no separate signup step, no password by default. *Why: identity here is just "a name someone picked," not an account. Onboarding **is** this form.*
2. Up to 20 names, one per line. Nothing else is collected about a member — ever.
3. Rows add dynamically; there's no fixed "how many people" question.
4. Tapping Create creates the group and lands directly on Screen 03 (the group itself) — no confirmation interstitial.

---

## Screen 02 — Open the shared link

*What a new person sees. Shown once per person, per phone.*

**Fields, top to bottom:**
- Group name heading — e.g. `Kyoto Trip`
- "Who are you?" label
- One large tappable row per member — `Yuto`, `Aya`, `Kenji`, `Mio`

**Notes:**
1. This *is* the join flow — no invite code, no email, no waiting for approval. The link plus this tap is the whole mechanism.
2. The choice is remembered on that device, so returning members skip straight to Screen 03. Treat these as big, unmistakable tap targets — this is a one-time decision people should get right on the first try.

---

## Screen 03 — Balances & history

*The home screen, and the one people return to most. Refreshes automatically, ~every 5 seconds.*

**Fields, top to bottom:**
- Group name heading
- **Balances** section — one row per member, name + signed ¥ amount
  - `Yuto (you)` `+¥6,200`
  - `Kenji` `+¥2,200`
  - `Aya` `−¥3,400`
  - `Mio` `−¥5,000`
- **History** section — newest first, one row per entry
  - `Onsen tickets` `¥8,000` — *Kenji paid · today*
  - `Taxi to station` `¥2,400` — *Aya paid · yesterday*
  - ~~`Coffee, refunded`~~ ~~`¥600`~~ — *(deleted)*
- Caption: "Invite friends: share this page's URL."
- Floating primary button: **Add expense**

**Notes:**
1. Green / red isn't decoration — it's literally "in the black" / "in the red," the ledger idiom this whole app is built on. Keep some clear positive/negative color pair here even after restyling.
2. History is newest-first, plain language ("Kenji paid"), not a transaction-ID list. It's meant to be skimmed, not audited.
3. Corrections never erase — a deleted or fixed entry shows struck through, permanently. The ledger only ever adds, never edits.
4. This caption is the entire "invite more people" feature. It deserves a real affordance (share sheet / copy button), not just a caption.
5. The single thumb-reachable primary action on the busiest screen in the app. Everything else here is read-only.

---

## Screen 04 — Add an expense

*Logged from any phone, mid-trip. One intent per tap of "Add."*

**Fields, top to bottom:**
- Heading: "Add expense"
- Total (¥) — whole yen input, e.g. `8,000`
- Paid by — select, e.g. `Kenji`
- "Who shared it?" — checkbox per member, all on by default
- Split mode tabs — **Equal** (default) / Exact / Shares / Percent
- Live preview — per-member amounts once total + mode are valid, e.g. `Yuto ¥2,000 · Aya ¥2,000 · Kenji ¥2,000 · Mio ¥2,000`
- Memo — text, e.g. `Onsen tickets`
- Date — defaults to today
- Primary button: **Add**

**Notes:**
1. Whole yen only, never cents. That's a hard rule of the ledger underneath, not a formatting choice — don't add a decimal point.
2. Not every expense includes everyone. Someone who skipped the taxi should be un-checked here, and their share reflows.
3. Equal needs nothing further. The other three modes are a real fork — each reveals one input per person (¥ / share count / %). Design all four, not just Equal.
4. This preview shows the exact yen amounts that will be booked — rounding included. If it's on screen, it has to be trustworthy, not an approximation.

---

## Coming next (concept, not yet built)

**Settle up** — the fewest possible transfers that zero out every balance, not "everyone pays the group," direct person-to-person:
- `Mio → Yuto` `¥5,000`
- `Aya → Yuto` `¥1,200`
- `Aya → Kenji` `¥2,200`

**Optional privacy** — any member can lock a group with a shared password. There's no email tied to a group, so a lost password is unrecoverable by design — the UI has to say so plainly, once, at set time.

---

## Fixed — please keep

- The four-screen flow and field set above.
- Green/red as "in the black / in the red."
- Struck-through, never removed, for corrections.
- One primary action per screen, thumb-reachable.
- 390px baseline — every screen usable one-handed.

## Open — yours to define

- Wordmark, color system, and type beyond the semantic pair.
- Iconography (share, add, checkmark, split-mode tabs).
- Empty states — a brand-new group with no expenses yet.
- Motion — the "just updated" balance pulse, transitions.
- How prominent the invite-link affordance should feel.
