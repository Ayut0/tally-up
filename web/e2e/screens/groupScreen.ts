import { expect, type Page, type Locator } from "@playwright/test";

/**
 * Screen 03 — the group home at `/g/{groupId}`: balances, history, and the
 * entry point to adding an expense (app/g/[groupId]/page.tsx).
 */
export class GroupScreen {
  constructor(private readonly page: Page) {}

  /**
   * Both lists render `<li>`s, so every lookup is scoped to its own named
   * region first — `getByRole("listitem")` unscoped would match balance rows
   * and history rows alike and trip Playwright's strict mode.
   */
  private get balances(): Locator {
    return this.page.getByRole("region", { name: "Balances" });
  }

  private get history(): Locator {
    return this.page.getByRole("region", { name: "History" });
  }

  async expectLoaded(groupName: string): Promise<void> {
    await expect(this.page.getByRole("heading", { name: groupName, level: 1 })).toBeVisible();
  }

  /**
   * Asserts one member's balance as rendered — the signed, grouped form from
   * lib/balance.ts (`+¥2,000`, `−¥1,000` with a real minus sign U+2212, `¥0`
   * when settled). Comparing against the displayed string, not a number,
   * keeps the feature file readable *and* covers the formatting the user
   * actually sees.
   *
   * Balances arrive via a poll, so this leans on `expect`'s auto-retry rather
   * than reading once — no explicit wait needed.
   */
  async expectBalance(memberName: string, formattedBalance: string): Promise<void> {
    const row = this.balances.getByRole("listitem").filter({ hasText: memberName });
    await expect(row).toContainText(formattedBalance);
  }

  async expectHistoryEntry(memo: string, payerName: string): Promise<void> {
    const row = this.history.getByRole("listitem").filter({ hasText: memo });
    await expect(row).toContainText(`${payerName} paid`);
  }

  async startAddingExpense(): Promise<void> {
    await this.page.getByRole("link", { name: "Add expense" }).click();
    await this.page.waitForURL(/\/g\/[0-9a-f-]{36}\/add$/);
  }

  /**
   * There is no separate invite route — the group URL *is* the invite link
   * (docs/architecture.md §2). Read it off the page rather than
   * reconstructing `/g/<id>`, so the join scenario never encodes routing
   * the app owns.
   */
  inviteLink(): string {
    return this.page.url();
  }

  /**
   * The floating "Add expense" action only renders once this browser has
   * an identity for the group (page.tsx) — `JoinPicker` never shows it,
   * even though it renders the same group-name heading. That makes this a
   * real positive check that a browser is past the picker, not a vacuous
   * "picker disappeared" (see e2e/README.md and issue #277's gotchas).
   */
  async expectOnGroupPage(): Promise<void> {
    await expect(this.page.getByRole("link", { name: "Add expense" })).toBeVisible();
  }
}
