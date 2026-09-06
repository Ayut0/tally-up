import { createBdd } from "playwright-bdd";
import { test } from "./fixtures";

const { When, Then } = createBdd(test);

When(
  "{word} asks to pay {word} a different amount",
  async ({ settle }, fromName: string, toName: string) => {
    await settle.openDifferentAmount(fromName, toName);
  },
);

Then(
  "the payment form is prefilled with payer {word} and counterparty {word}",
  async ({ recordPayment }, payerName: string, counterpartyName: string) => {
    await recordPayment.expectPayerIs(payerName);
    await recordPayment.expectCounterpartyIs(counterpartyName);
  },
);

// fromName/toName only echo what the previous step already asserted as
// prefilled, so this step doesn't re-check them — that's
// "the payment form is prefilled…"'s job, not this one's.
When(
  "{word} pays {word} ¥{int} with memo {string}",
  async ({ recordPayment }, _fromName: string, _toName: string, yen: number, memo: string) => {
    await recordPayment.fillAmount(yen);
    await recordPayment.fillMemo(memo);
    await recordPayment.submit();
  },
);

When("someone opens a broken record-payment link", async ({ recordPayment }) => {
  await recordPayment.openBroken();
});

Then("someone sees a {string} error", async ({ recordPayment }, message: string) => {
  await recordPayment.expectError(message);
});
