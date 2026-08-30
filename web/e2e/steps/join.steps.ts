import { createBdd } from "playwright-bdd";
import { test } from "./fixtures";

const { When, Then } = createBdd(test);

/**
 * "opens the invite link" (issue #277) means literally that: there's no
 * separate invite route, so the second phone navigates to the first
 * phone's own current URL rather than reconstructing `/g/<id>`.
 */
When("a second phone opens the invite link", async ({ group, secondPhone }) => {
  await secondPhone.join.open(group.inviteLink());
});

When("picks {word}", async ({ secondPhone }, memberName: string) => {
  await secondPhone.join.pickMember(memberName);
});

Then("the second phone lands on the group page", async ({ secondPhone }) => {
  await secondPhone.group.expectOnGroupPage();
});

When("the second phone reopens the invite link", async ({ group, secondPhone }) => {
  await secondPhone.join.open(group.inviteLink());
});

// The persistence assertion: re-navigating in the *same* context should
// land straight on the group page, not the picker, proving the
// localStorage identity survived — a bare "picker is gone" would also pass
// on a page that errored, so this checks for the group page positively.
Then("the second phone is not asked again", async ({ secondPhone }) => {
  await secondPhone.group.expectOnGroupPage();
});

// The inverse of the persistence assertion above: a browser that has never
// picked has nothing in localStorage to remember, so reopening the same
// link must show the picker again, not skip it.
Then("the second phone is asked who they are", async ({ secondPhone }) => {
  await secondPhone.join.expectShown();
});

When("a second phone opens a broken invite link", async ({ secondPhone }) => {
  await secondPhone.join.openBrokenLink();
});

Then("the second phone sees a {string} error", async ({ secondPhone }, message: string) => {
  await secondPhone.group.expectError(message);
});
