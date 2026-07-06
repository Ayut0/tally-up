# Group Membership, Privacy, and Pairwise Balances — Design

Extends `docs/architecture.md` with three features surfaced during use-case review (`docs/use-cases.md`): true pairwise "who owes whom," add/remove group members, and an optional per-group password. None of these change the ledger core already covered by Phases 1–2 (`docs/superpowers/plans/2026-07-05-ledger-core-write-path.md`); they build on top of it.

**Explicit non-goal, confirmed with the user:** no user registration or accounts. There are no logins, no email, no per-person credentials anywhere in this design. Identity stays exactly as already designed — pick your name from the group's member list (`docs/superpowers/plans/2026-07-05-nextjs-client.md`, localStorage-based). The password introduced below is a single **shared secret per group**, not a login system: it proves you know the group's secret, nothing about *which* member you are. Anyone who knows it can still act as any member, same as today.

---

## 1. Who owes whom (pairwise balances)

### Why no schema change is needed
Every expense entry already has exactly one payer (`entries.payer_id`) and a participant list. That single fact fully determines the pairwise relationship for that expense: each non-payer participant owes the payer their computed share — no ambiguity, no minimization algorithm needed. Settlements are already two-party by construction (`payer_id` pays `counterparty`). Reversals already copy `payer_id`/`counterparty`/`participants` from the original with negated postings (`docs/superpowers/plans/2026-07-05-reads-and-reversals.md` Task 3), so they compose into this derivation automatically without special-casing.

### Derivation
For each entry in a group, contribute a signed edge to a per-unordered-pair accumulator:

- **Expense-shaped** (`counterparty IS NULL`): for every posting row where `member_id != payer_id`, the (necessarily negative) posting amount `a` contributes `-a` (positive) to `pairwise(member_id owes payer_id)`.
- **Settlement-shaped** (`counterparty IS NOT NULL`): the payer's own posting amount `X` (positive, since they paid out cash) contributes `-X` to `pairwise(payer_id owes counterparty)` — paying discharges debt, so it's a negative contribution to "payer owes counterparty."

Both cases read only from `entries` + `postings` — no new columns, no new tables. Accumulate all contributions per unordered pair `{A, B}` (canonicalized by UUID byte order), net them into a single signed amount, and **drop pairs that net to exactly zero** — unlike the `balances` view (which always lists every member), this view is meant to answer "who owes whom," so a zero relationship carries no information and would just add noise for large groups.

### Interface
- `store.PairwiseBalance{A uuid.UUID; B uuid.UUID; Amount int64}` — by convention `A < B` (byte order); `Amount > 0` means A owes B, `Amount < 0` means B owes A. Never zero (zero pairs are omitted).
- `(*Store) GetPairwiseBalances(ctx, groupID) ([]PairwiseBalance, error)` — two queries (expense contributions, settlement contributions), netted and filtered in Go, mirroring the existing two-query pattern in `ListEntries`.
- Route: `GET /groups/{group_id}/pairwise-balances` → `{"balances": [{"a":…, "b":…, "amount":…}]}`.

### Correctness check
A property test asserts: for every member M, the signed sum of all pairwise edges touching M (with correct sign relative to M) equals M's net balance from the existing `balances` view. This ties the new read-model back to an already-proven invariant rather than introducing an independent, unverified one.

### Relationship to settle-up
Unchanged and untouched. Settle-up (Phase 6) stays the minimal-transfer proposal for actually paying off debts efficiently; this is a separate, purely informational view. The client can show both: "here's the real history" and "here's the fastest way to zero out."

---

## 2. Add / remove group members

### Add
Inserting a member after group creation is unremarkable: a new `group_members` row, no prior postings, so their balance starts at zero — already correct under the existing model with no special-casing.

- `(*Store) AddMember(ctx, key uuid.UUID, groupID uuid.UUID, name string) (GroupMember, error)` — same idempotency-key convention as every other create in this system (`docs/superpowers/plans/2026-07-05-ledger-core-write-path.md` §4); name validated 1–50 chars trimmed, matching `createGroupRequest`'s existing member-name rule.
- Route: `POST /groups/{group_id}/members`, `Idempotency-Key` required, body `{"name": "..."}`. 201 + the new member on success.

### Remove
Blocked unless the member's current balance is exactly zero — checked via the same computation `GetBalances` already performs. This guarantees "removed" always means "fully squared away," with no new ledger mechanism, no forced settlement flow, and no ambiguity about what happens to their history.

- `store.ErrNonzeroBalance = errors.New("member has a nonzero balance; settle up before removing")`.
- `(*Store) RemoveMember(ctx, groupID, memberID uuid.UUID) error` — deletes the `group_members` row only (never the `members` row itself — historical `entries`/`postings` keep their FK to the member, so past history stays fully intact and readable forever; the member just can't be selected as a participant in *new* entries going forward, enforced by the existing membership check in `CreateEntry`).
- Route: `DELETE /groups/{group_id}/members/{member_id}`. **No Idempotency-Key** — a DELETE is naturally idempotent (repeating it has the same end state), so the standard create-side gate doesn't apply here; the endpoint returns 204 whether the member was already removed or not, 409 if their balance is nonzero, 404 if the group or member doesn't exist at all.
- **Permissions:** any member can add or remove any other member. No owner/privileged-member concept is introduced — this matches the existing flat-trust design where every member is equal.

---

## 3. Optional per-group password

### What it is and isn't
One shared secret per group, set by any member, gating **everything** — reads and writes both, per the confirmed answer that "secret" should mean literally nothing is visible without it. This is the first real access-control concept in the system (previously deferred, per `docs/architecture.md` §2's stated v1 trade-off); it does not change the capability-URL model, it adds a second gate on top of it.

### Schema (new migration, after Phase 1–2's `0001_init`)
```sql
ALTER TABLE groups ADD COLUMN password_hash TEXT;              -- NULL = no password set (today's fully-open behavior)
ALTER TABLE groups ADD COLUMN password_version INT NOT NULL DEFAULT 0;
```
`password_version` increments on every set/change/clear, which is what invalidates every previously issued token — no session table, no explicit revocation list needed.

### Hashing
bcrypt (`golang.org/x/crypto/bcrypt`), default cost. The threat model here is "keep randoms who don't have the password out," not defending a high-value target, so this is an appropriately-sized choice, not an under-built one.

### Token
A compact, stateless, HMAC-SHA256-signed token embedding `group_id`, `password_version`, and an expiry (30 days — long enough that re-entering a password is rare, short enough to bound a leaked token's lifetime). Signed with a server-held secret (`TOKEN_SIGNING_SECRET` env var). No JWT library needed — this is a small, fixed payload with one signature.

- Verifying a token checks: signature valid, `group_id` matches the route, `password_version` matches the group's *current* version (a password change silently invalidates every old token the instant it happens), not expired.

### The one deliberate exception to "gate everything"
The client cannot know whether a group requires a password without asking *something* that isn't itself gated — otherwise unlocking can never bootstrap. One narrow, minimal-leak endpoint is exempt:

- `GET /groups/{group_id}/password-required` → `{"required": true|false}` if the group exists, **404** if it doesn't. This confirms existence and lock status only, and nothing else — no balances, no member names, no history. That's the same amount of information the capability-URL model already implies (whoever has the exact UUID can at least probe its existence); it does not weaken the password's protection of the group's actual data.

### Endpoints
- `PUT /groups/{group_id}/password` — body `{"password": "<string>" | null}` (`null` clears the password, reopening the group). Like every other group-scoped endpoint, this itself requires a valid current token whenever a password is *already* set — so changing a password requires already being unlocked. Setting the very first password (from `NULL`) needs no token, since the group is open by definition until that call succeeds.
- `POST /groups/{group_id}/unlock` — body `{"password": "<string>"}`; verifies against `password_hash` with bcrypt; 200 + `{"token": "<signed token>"}` on match, 401 otherwise. If the group has no password set, this endpoint isn't needed — the client skips straight to normal use (see client flow below).

### Server-side enforcement
Middleware wraps every group-scoped route except `POST /groups` (create — no group exists yet to have a password), `GET /groups/{group_id}/password-required`, and `POST /groups/{group_id}/unlock`. For each request: look up the group's `password_hash`/`password_version` (cheap, indexed lookup). If `password_hash IS NULL`, pass through untouched — fully backward compatible with every already-planned endpoint. If set, require `Authorization: Bearer <token>`, verify it as above, 401 on any failure (missing header, bad signature, stale version, expired).

### Client flow
Opening `/g/{groupId}` becomes:
1. `GET /groups/{id}/password-required`.
2. If required and no valid stored token for this group (`localStorage` key `tallyup:token:<groupId>`) → show an unlock screen; `POST /groups/{id}/unlock`; store the returned token; proceed.
3. If not required, or a token is already stored → proceed directly into the existing flow (fetch group, identity picker, balances, etc.), attaching `Authorization: Bearer <token>` on every request whenever a token is stored for that group.
4. Any 401 response means the stored token is stale (most likely: someone changed the password) — drop it and re-show the unlock screen. This transparently self-heals without the user needing to understand why.

### Lost password
No recovery path. This is an accepted, explicit trade-off given there are no accounts or email to recover through — the UI states this plainly at the moment a password is set ("if this is lost, this group's data is inaccessible forever"), not buried in documentation only.

---

## Testing shape (for the implementation plan to follow)

- **Pairwise balances:** example tests mirroring the worked examples already in the architecture doc and ledger plan, plus the cross-check property test against `GetBalances`.
- **Member add/remove:** add-then-immediately-usable-as-participant; remove-with-zero-balance succeeds; remove-with-nonzero-balance rejected; removed member's historical entries still read back correctly via `ListEntries`.
- **Password:** set → subsequent unauthenticated request 401; correct unlock → token works; wrong password → 401, no token issued; password change → old token now 401, new unlock required; clear password (`null`) → group fully open again, no token needed; token for group A rejected on group B's routes.

## Suggested phase split (decided at implementation-planning time, not here)
Pairwise balances and member add/remove are small, low-risk, and share no new infrastructure — natural to plan together as one phase. Password protection is larger and introduces the system's first real access-control layer (middleware, token signing, a new client bootstrap step) — worth its own phase so it can be reviewed and tested in isolation.
