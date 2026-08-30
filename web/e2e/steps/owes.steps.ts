import { createBdd } from "playwright-bdd";
import { test } from "./fixtures";

const { When, Then } = createBdd(test);

// No named actor: the pairwise view isn't personalized (unlike
// BalanceList's "(you)" tag), so naming a specific member here would imply
// a personalization the page doesn't have.
When("someone checks who owes whom", async ({ group }) => {
  await group.viewWhoOwesWhom();
});

Then(
  "{word} owes {word} ¥{int}",
  async ({ owes }, debtorName: string, creditorName: string, yen: number) => {
    await owes.expectDebt(debtorName, creditorName, `¥${yen}`);
  },
);

Then("the group is settled up", async ({ owes }) => {
  await owes.expectSettled();
});
