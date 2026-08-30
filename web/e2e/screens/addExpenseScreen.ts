import { expect, type Page } from "@playwright/test";

/** The split modes the UI offers, as labelled on the tab strip. */
export type SplitMode = "Equal" | "Exact" | "Shares" | "Percent";

/**
 * Screen 04 — the add-expense form at `/g/{groupId}/add`
 * (app/g/[groupId]/add/page.tsx).
 */
export class AddExpenseScreen {
  constructor(private readonly page: Page) {}

  async fillTotal(yen: number): Promise<void> {
    // Integer yen only, everywhere (README) — the field strips non-digits, so
    // a number is the honest input type here.
    await this.page.getByLabel("Total amount in yen").fill(String(yen));
  }

  /**
   * "Paid by" is a HeroUI/react-aria Select, not a native `<select>`: a
   * trigger button plus a listbox rendered in a portal at body level. Hence
   * the two steps — scope to the field to open it, then pick the option
   * globally, because the popover is not a DOM descendant of the field.
   */
  async choosePayer(memberName: string): Promise<void> {
    await this.page.locator("label").filter({ hasText: "Paid by" }).getByRole("button").click();
    await this.page.getByRole("option", { name: memberName }).click();
  }

  async chooseSplitMode(mode: SplitMode): Promise<void> {
    await this.page.getByRole("tab", { name: mode }).click();
  }

  /**
   * Asserts a member shows as a checked "Who shared it?" pill
   * (ParticipantPills renders a checked pill's accessible name as
   * `"✓ " + name`). Proves more than presence in the member list: the
   * form's default participants come from `group.members` at mount
   * (useAddExpenseForm), so this only passes if the add actually landed in
   * the shared group-query cache the add-expense screen reads too.
   */
  async expectParticipant(memberName: string): Promise<void> {
    await expect(this.page.getByRole("button", { name: `✓ ${memberName}` })).toBeVisible();
  }

  async fillMemo(memo: string): Promise<void> {
    await this.page.getByLabel("Memo").fill(memo);
  }

  async submit(): Promise<void> {
    await this.page.getByRole("button", { name: "Add" }).click();
    // Success navigates back to the group home; staying put means the write
    // failed and the form is showing an error.
    await this.page.waitForURL(/\/g\/[0-9a-f-]{36}$/);
  }
}
