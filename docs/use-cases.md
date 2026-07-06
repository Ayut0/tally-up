# tally-up — Use Cases

Four use cases from the user, checked against the architecture (`docs/architecture.md`) and implementation plans (`docs/superpowers/plans/`). **All four are now covered.** #2 and #3 were covered by the original design; #1 and #4 surfaced new scope that has since been designed in `docs/superpowers/specs/2026-07-06-group-membership-privacy-pairwise-design.md` and folded back into `docs/architecture.md` (§7 API, §9 phases 7–8). The open questions each raised, and how they were resolved, are kept below as the design record.

---

## 1. Add or remove friends/family members from a group

> "Users can add or remove friends or family members whom they want to tally up the total expense."

**Status: covered** — designed in the spec (§2) and planned in `docs/superpowers/plans/2026-07-06-pairwise-and-member-management.md`; reflected in `docs/architecture.md` §7 (`POST`/`DELETE /groups/:id/members…`) and §9 phase 7. Adding inserts a `group_members` row (idempotent create); removing deletes only the membership link and is **rejected unless the member's balance is exactly zero** — option (b) below. Any member can add or remove any member (flat trust, no owner concept).

The open questions this originally raised, kept as the design record:
- **Adding** a member mid-trip is straightforward — insert a new `group_members` row. They simply have no postings before they joined, which is already correct behavior (the ledger only records postings for entries where someone participated).
- **Removing** a member is the harder case, because the ledger is append-only and a removed member may already have historical postings (they owe money, or are owed money). Real options:
  - (a) "Remove" only means "hide from future add-expense participant pickers" — their historical postings and balance stand forever until settled. This preserves the append-only/audit invariants with zero new mechanism.
  - (b) "Remove" requires the member's balance to already be zero (they've settled up), otherwise the removal is rejected — a light guarantee that "removed" means "fully squared away," not "conveniently forgotten."
  - (c) Something more involved (forced settlement, transfer of their balance to someone else) — significantly more complex, probably not v1.
- This also touches the client (who can remove whom — any member, or only the group creator? tally-up currently has no privileged-member concept at all).

## 2. Tally up the total expense of activities

> "Users can tally up the total expense of their activities."

**Status: already covered.** This is the core ledger feature — adding expense entries with a split rule, and reading back balances (`docs/architecture.md` §3, `POST /groups/{id}/entries`, `GET /groups/{id}/balance`). No new design needed.

## 3. Share a URL where people can input their expenses

> "User can share URL where they can input their expenses."

**Status: already covered.** This is exactly the invite-link / capability-URL sharing model already in `docs/architecture.md` §2 and the Next.js client plan (`/g/<group-id>`, join-by-picking-yourself flow). No new design needed.

## 4. Optional password to keep a group's calculation secret

> "Users can set a password for their calculation if they want. So that it'd be secret."

**Status: covered** — designed in the spec (§3) and planned in `docs/superpowers/plans/2026-07-06-group-password.md`; reflected in `docs/architecture.md` §2, §6 (`password_hash`/`password_version`), §7, and §9 phase 8. Decided: one **server-enforced** shared secret per group (bcrypt), gating **all** reads and writes; unlocking exchanges the password for a stateless HMAC-signed token; changing the password bumps a version column that invalidates every old token; a lost password is **unrecoverable by design** (no accounts/email), stated plainly in the UI at set time.

The design questions this originally raised, kept as the design record:
- **Where does the check happen?** Client-side only (trivially bypassed, but zero-cost and matches "friend group, casual" trust level) vs. server-enforced (real protection, but means the server now holds and checks a secret — hashing, rate-limiting guesses, a "forgot password" story since there's no email/account system).
- **What does the password actually protect?** Viewing balances/history, or also adding expenses, or both?
- **Set by whom, and changeable by whom?** Only at group creation, or any time, by any member or only the creator?
- **Is a lost password recoverable?** With no accounts/email in v1, a lost password on a server-enforced design could permanently lock everyone out of their own ledger — needs an explicit answer.
- This is the first place tally-up would need a real "who is allowed to do this" concept, which the architecture has so far deliberately deferred (v1 non-goal: real auth is "upgraded later if it ever needs to").

---

## Resolution

Both open items were resolved through the brainstorming flow and recorded in `docs/superpowers/specs/2026-07-06-group-membership-privacy-pairwise-design.md`:

1. **#1 removal semantics:** option (b) — removal requires a zero balance; history is never touched. Permissions stay flat: any member can add/remove any member.
2. **#4 password:** server-enforced, gates everything (reads and writes), bootstrap via one ungated `password-required` probe, and no recovery path for a lost password.

Implementation is planned as phases 7–8 (`docs/superpowers/plans/2026-07-06-pairwise-and-member-management.md`, `docs/superpowers/plans/2026-07-06-group-password.md`); `docs/architecture.md` reflects both.
