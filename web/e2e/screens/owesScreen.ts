import { expect, type Page, type Locator } from "@playwright/test";

/**
 * Screen — the "Who owes whom" pairwise view at `/g/{groupId}/owes`
 * (app/g/[groupId]/owes/page.tsx). A derived read model, not the ledger
 * itself (docs/architecture.md §3): the server reconstructs directed edges
 * from each entry's payer, so this screen is what proves the client renders
 * the same debtor/creditor/amount the server actually computed.
 */
export class OwesScreen {
  constructor(private readonly page: Page) {}

  private get pairs(): Locator {
    return this.page.getByRole("region", { name: "Who owes whom" });
  }

  /**
   * Filters on the literal "{debtor} owes {creditor}" phrase the page
   * renders (page.tsx: `{debtor} <span>owes</span> {creditor}`, which
   * collapses to that exact text), not just both names' presence —
   * `hasText` on each name separately would match this row for either
   * ordering of the same pair, making the direction check vacuous. Caught
   * by this ticket's own negative-verification pass: swapping the debtor
   * and creditor arguments must find no row, not just a differently-labeled
   * one.
   */
  async expectDebt(
    debtorName: string,
    creditorName: string,
    formattedAmount: string,
  ): Promise<void> {
    const row = this.pairs
      .getByRole("listitem")
      .filter({ hasText: `${debtorName} owes ${creditorName}` });
    await expect(row).toContainText(formattedAmount);
  }

  async expectSettled(): Promise<void> {
    await expect(
      this.pairs.getByText("All settled up — nobody owes anybody anything."),
    ).toBeVisible();
  }
}
