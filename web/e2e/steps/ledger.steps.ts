import { createBdd, type DataTable } from "playwright-bdd";
import { test } from "./fixtures";

const { Given, When, Then } = createBdd(test);

/**
 * Steps are the translation layer: domain sentence in, screen calls out.
 * They hold no selectors (those live in e2e/screens) and no assertions of
 * their own beyond delegating to a screen — keeping them thin is what lets
 * one step be reused by many scenarios.
 */

Given(
  "a group named {string} with members:",
  async ({ home, group }, groupName: string, members: DataTable) => {
    const names = members.hashes().map((row) => row.name!);
    await home.open();
    await home.createGroup(groupName, names);
    await group.expectLoaded(groupName);
  },
);

// {word} rather than {string} so the feature reads `When Yuto adds…` without
// quoting a member's name mid-sentence; the memo stays quoted because it is
// free text the user typed, not a domain identifier.
When(
  "{word} adds an expense of ¥{int} for {string} split equally",
  async ({ group, addExpense }, payerName: string, yen: number, memo: string) => {
    await group.startAddingExpense();
    await addExpense.choosePayer(payerName);
    await addExpense.fillTotal(yen);
    await addExpense.chooseSplitMode("Equal");
    await addExpense.fillMemo(memo);
    await addExpense.submit();
  },
);

Then("the balances are:", async ({ group }, balances: DataTable) => {
  for (const row of balances.hashes()) {
    await group.expectBalance(row.member!, row.balance!);
  }
});

Then(
  "the history shows {string} paid by {word}",
  async ({ group }, memo: string, payerName: string) => {
    await group.expectHistoryEntry(memo, payerName);
  },
);
