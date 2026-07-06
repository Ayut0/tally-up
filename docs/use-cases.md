# tally-up — Use Cases (Draft for Review)

Four use cases from the user, checked against the current architecture (`docs/architecture.md`) and implementation plans (`docs/superpowers/plans/`). Two are already fully covered by the existing design; two introduce new scope that the current plans don't address. Nothing here is decided yet — this is the input to a design discussion, not a spec.

---

## 1. Add or remove friends/family members from a group

> "Users can add or remove friends or family members whom they want to tally up the total expense."

**Status: not covered.** The current design only creates group members once, at group creation (`POST /groups` takes a fixed `member_names` list; see the client plan's Task 1 and `docs/architecture.md` §6's `group_members` table). There is no "add member to an existing group" or "remove member" operation anywhere in the four plans.

Open questions this raises against the ledger model:
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

**Status: not covered — and in tension with the current sharing model.** Today, knowing the group's URL *is* the entire access model (architecture §2: "the group URL is the capability"). A password is a second, independent gate on top of that, and raises design questions:
- **Where does the check happen?** Client-side only (trivially bypassed, but zero-cost and matches "friend group, casual" trust level) vs. server-enforced (real protection, but means the server now holds and checks a secret — hashing, rate-limiting guesses, a "forgot password" story since there's no email/account system).
- **What does the password actually protect?** Viewing balances/history, or also adding expenses, or both?
- **Set by whom, and changeable by whom?** Only at group creation, or any time, by any member or only the creator?
- **Is a lost password recoverable?** With no accounts/email in v1, a lost password on a server-enforced design could permanently lock everyone out of their own ledger — needs an explicit answer.
- This is the first place tally-up would need a real "who is allowed to do this" concept, which the architecture has so far deliberately deferred (v1 non-goal: real auth is "upgraded later if it ever needs to").

---

## What's next

Once you've reviewed this, the open items are:
1. For #1: which removal semantics (a/b/c above), and who's allowed to remove someone.
2. For #4: client-side-only vs. server-enforced, what it gates, and the lost-password story.

These two feed a short design doc (via the brainstorming flow) before they turn into implementation plan updates — #1 and #4 both touch the group data model and the API surface already planned in the four existing plans, so they're best designed before more implementation work starts.
