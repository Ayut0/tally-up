import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/**
 * Screen — the record-payment form at `/g/{groupId}/record-payment`
 * (app/g/[groupId]/record-payment/page.tsx). The escape hatch for a
 * payment that isn't the plan's exact proposed amount (#161) — partial,
 * rounded, or fronted. Reached from the settle plan's "Different amount"
 * link with payer/counterparty prefilled from `?payer=&counterparty=`.
 */
export class RecordPaymentScreen {
  constructor(private readonly page: Page) {}

  /**
   * "Paid by" and "Pays" are HeroUI/react-aria Selects — a trigger button,
   * not a native `<select>` (same shape AddExpenseScreen.choosePayer
   * handles). This screen only ever reads a trigger's current text, never
   * opens the popover to pick an option, so it doesn't need that pattern's
   * "click to open, then pick" second step.
   */
  private trigger(label: string) {
    return this.page.locator("label").filter({ hasText: label }).getByRole("button");
  }

  /**
   * Reads the field's value off its trigger button rather than opening the
   * popover — opening it would be an action of its own, not an honest
   * check of a value nobody has touched yet.
   */
  async expectPayerIs(memberName: string): Promise<void> {
    await expect(this.trigger("Paid by")).toContainText(memberName);
  }

  /**
   * Substring match, not exact: a creditor renders in "Pays" as
   * `"{name} (owed ¥N)"` (page.tsx), so the member name alone must still
   * match.
   */
  async expectCounterpartyIs(memberName: string): Promise<void> {
    await expect(this.trigger("Pays")).toContainText(memberName);
  }

  async fillAmount(yen: number): Promise<void> {
    await this.page.getByLabel("Amount (¥)").fill(String(yen));
  }

  async fillMemo(memo: string): Promise<void> {
    await this.page.getByLabel("Memo (optional)").fill(memo);
  }

  async submit(): Promise<void> {
    await this.page.getByRole("button", { name: "Record payment" }).click();
    // Success navigates back to the group home; staying put means the write
    // failed and the form is showing an error.
    await this.page.waitForURL(/\/g\/[0-9a-f-]{36}$/);
  }

  /**
   * A syntactically valid group id that nothing created — same shape as
   * JoinScreen.openBrokenLink, but for this screen's own error branch
   * (useGroupAndBalance), not the group page's.
   */
  async openBroken(): Promise<void> {
    await this.page.goto(`/g/${randomUUID()}/record-payment`);
  }

  /**
   * page.tsx's error branch renders the API's own message verbatim.
   * TanStack Query's default `retry: 3` still runs against a 404 before
   * settling into this state, hence the longer timeout (mirrors
   * GroupScreen.expectError).
   */
  async expectError(message: string): Promise<void> {
    await expect(this.page.getByText(message)).toBeVisible({ timeout: 15_000 });
  }
}
