import { expect, type Page, type Locator } from "@playwright/test";

/**
 * Screen — the settle-up plan at `/g/{groupId}/settle`
 * (app/g/[groupId]/settle/page.tsx). Renders straight from the polled plan
 * with no local copy (#150) — a transfer a recompute has dropped simply has
 * no row, so it can't be tapped. Its rows are a bare `<ul>`, not a named
 * landmark like Balances/History/Who-owes-whom, so rows are found by their
 * own rendered text instead of a scoping region.
 */
export class SettleScreen {
  constructor(private readonly page: Page) {}

  private row(fromName: string, toName: string): Locator {
    // Filters on the literal "{from} pays {to}" phrase the page renders
    // (page.tsx: `{nameOf(transfer.from)} pays {nameOf(transfer.to)}`), not
    // just both names' presence — matching on each name separately would
    // find this row for either ordering of the same pair, making a
    // direction check vacuous. Same trick as owesScreen.expectDebt.
    return this.page.getByRole("listitem").filter({ hasText: `${fromName} pays ${toName}` });
  }

  async expectProposes(fromName: string, toName: string, formattedAmount: string): Promise<void> {
    await expect(this.row(fromName, toName)).toContainText(formattedAmount);
  }

  /**
   * The negative half of `expectProposes`: proves a specific transfer's row
   * is gone, not just that the plan as a whole is non-empty. Auto-retries
   * (Playwright's default `toHaveCount` polling) rather than a fixed sleep,
   * since the row disappearing depends on the next poll landing.
   *
   * A same-browser write invalidates the query immediately, so this settles
   * fast in practice — but a write from a *different* browser (the
   * concurrent-settle scenario) has no invalidation to ride on here: the
   * 5s poll interval (`useSettlePlan.ts`) is the only thing that will ever
   * make this locator's count change. Playwright's 5000ms default timeout
   * would then be racing that exact interval, so this needs headroom past
   * it rather than reusing the default.
   */
  async expectGone(fromName: string, toName: string): Promise<void> {
    await expect(this.row(fromName, toName)).toHaveCount(0, { timeout: 7_000 });
  }

  /**
   * Clicks "Mark paid" for one proposed transfer. Deliberately does not wait
   * for the row to disappear here — every row disables while any record is
   * in flight, and the plan only recomputes on its next poll, so the honest
   * wait belongs to the caller's next assertion (an auto-retrying `expect`),
   * never a fixed sleep inside this method.
   *
   * `yen` is the raw integer (the Gherkin step's `¥{int}`), formatted here
   * with the same `toLocaleString("ja-JP")` the page uses to build its
   * aria-label — mirrors ledger.steps.ts taking a raw yen int while the
   * page renders the grouped, comma'd form.
   */
  async pay(fromName: string, toName: string, yen: number): Promise<void> {
    const amount = yen.toLocaleString("ja-JP");
    await this.page
      .getByRole("button", { name: `Mark paid: ${fromName} pays ${toName} ¥${amount}` })
      .click();
  }

  /**
   * The "Different amount" escape hatch (#161) on one proposed transfer's
   * row — deep-links to record-payment with payer/counterparty prefilled.
   * Playwright's default substring match on `name` means the amount the
   * real aria-label also carries (`Different amount: {description}`)
   * doesn't need reproducing here.
   */
  async openDifferentAmount(fromName: string, toName: string): Promise<void> {
    await this.page
      .getByRole("link", { name: `Different amount: ${fromName} pays ${toName}` })
      .click();
    await this.page.waitForURL(/\/record-payment\?/);
  }

  async expectEmpty(): Promise<void> {
    await expect(this.page.getByText("All settled up — every balance is ¥0.")).toBeVisible();
  }

  async returnToGroup(): Promise<void> {
    await this.page.getByRole("link", { name: "Back" }).click();
    await this.page.waitForURL(/\/g\/[0-9a-f-]{36}$/);
  }
}
