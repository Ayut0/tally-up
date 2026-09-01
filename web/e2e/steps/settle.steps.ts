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

When("the second phone views the settle plan", async ({ secondPhone }) => {
  await secondPhone.group.viewSettlePlan();
});

// A second phone doing the marking, not "someone" — this is what actually
// exercises #150's concurrency defence: the write comes from a browser the
// first phone's plan (`settle`) never touches, so the first phone's own
// screen has no way to know except its next poll.
When(
  "the second phone marks {word} pays {word} ¥{int}",
  async ({ secondPhone }, fromName: string, toName: string, yen: number) => {
    await secondPhone.settle.pay(fromName, toName, yen);
  },
);
