import { createBdd, type DataTable } from "playwright-bdd";
import { test } from "./fixtures";

const { When, Then } = createBdd(test);

// No named actor: like "someone checks who owes whom" (owes.steps.ts), the
// settle plan isn't personalized to whoever is viewing it.
When("someone views the settle plan", async ({ group }) => {
  await group.viewSettlePlan();
});

Then("the settle plan proposes:", async ({ settle }, transfers: DataTable) => {
  for (const row of transfers.hashes()) {
    await settle.expectProposes(row.from!, row.to!, row.amount!);
  }
});

When(
  "{word} pays {word} ¥{int}",
  async ({ settle }, fromName: string, toName: string, yen: number) => {
    await settle.pay(fromName, toName, yen);
  },
);

Then("the settle plan is empty", async ({ settle }) => {
  await settle.expectEmpty();
});

Then(
  "the settle plan no longer proposes {word} pays {word}",
  async ({ settle }, fromName: string, toName: string) => {
    await settle.expectGone(fromName, toName);
  },
);

When("someone returns to the group", async ({ settle }) => {
  await settle.returnToGroup();
});
