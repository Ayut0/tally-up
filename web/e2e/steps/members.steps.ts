import { createBdd } from "playwright-bdd";
import type { MembersScreen } from "../screens/membersScreen";
import { test } from "./fixtures";

const { When, Then } = createBdd(test);

/**
 * Steps for membership changing mid-trip (issue #279): joining, and
 * attempting or completing a removal. Own file, mirroring how
 * ledger.steps.ts owns expense/balance sentences — this one owns
 * membership sentences. The existing "the balances are:" step
 * (ledger.steps.ts) is reused as-is to assert a newly-joined member's ¥0
 * balance.
 */

/** Requesting removal and confirming it is the same UI action whether the
 * server ultimately allows it or not — only the outcome differs, asserted
 * by the Then steps below. */
async function attemptRemove(members: MembersScreen, name: string): Promise<void> {
  await members.requestRemove(name);
  await members.confirmRemove(name);
}

When("{word} joins the group", async ({ members }, name: string) => {
  await members.add(name);
});

Then("{word} is available to split expenses with", async ({ group, addExpense }, name: string) => {
  await group.startAddingExpense();
  await addExpense.expectParticipant(name);
});

When("{word} tries to leave the group", async ({ members }, name: string) => {
  await attemptRemove(members, name);
});

When("{word} leaves the group", async ({ members }, name: string) => {
  await attemptRemove(members, name);
});

// `_name` is unused: the assertion below is scoped to whichever member's
// confirm dialog is already open, so the sentence names them for
// readability without the step needing to re-select by name.
Then("{word} is refused: {string}", async ({ members }, _name: string, message: string) => {
  await members.expectRemovalRefused(message);
});

Then("{word} is still a member of the group", async ({ members }, name: string) => {
  await members.expectMember(name);
});

Then("{word} is no longer a member of the group", async ({ members }, name: string) => {
  await members.expectNoMember(name);
});
