import { expect, type Page, type Locator } from "@playwright/test";

/**
 * Screen — the Members section on the group home at `/g/{groupId}`
 * (app/g/[groupId]/memberList.tsx).
 *
 * Split out from GroupScreen rather than added there: GroupScreen already
 * owns two regions (Balances, History), and a third region's worth of
 * locators is exactly the point at which e2e/README.md's page-object rule
 * says to split.
 */
export class MembersScreen {
  constructor(private readonly page: Page) {}

  private get members(): Locator {
    return this.page.getByRole("region", { name: "Members" });
  }

  private get confirmDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Confirm remove member" });
  }

  private row(name: string): Locator {
    return this.members.getByRole("listitem").filter({ hasText: name });
  }

  /**
   * Fills and submits the add-member form. No navigation on success — the
   * form stays on the group page and cache invalidation is what makes the
   * new row appear (useAddMember), so the "done" signal is the row itself,
   * not a URL wait — same gotcha as HomeScreen/GroupScreen.
   */
  async add(name: string): Promise<void> {
    await this.members.getByLabel("Add a member").fill(name);
    await this.members.getByRole("button", { name: "Add" }).click();
    await expect(this.row(name)).toBeVisible();
  }

  async expectMember(name: string): Promise<void> {
    await expect(this.row(name)).toBeVisible();
  }

  async expectNoMember(name: string): Promise<void> {
    await expect(this.row(name)).toHaveCount(0);
  }

  async requestRemove(name: string): Promise<void> {
    await this.row(name).getByRole("button", { name: "Remove" }).click();
  }

  /**
   * The confirm button's accessible name is `Remove ${name}` (memberList.tsx),
   * distinct from the row's own bare "Remove" button so this doesn't collide
   * with it even though the dialog isn't DOM-scoped inside the row.
   */
  async confirmRemove(name: string): Promise<void> {
    await this.confirmDialog.getByRole("button", { name: `Remove ${name}` }).click();
  }

  /**
   * Asserts the refusal as rendered state inside the still-open dialog, not
   * just that the dialog stayed open — the load-bearing check is the error
   * text the 409 response body produced.
   */
  async expectRemovalRefused(message: string): Promise<void> {
    await expect(this.confirmDialog.getByText(message)).toBeVisible();
  }
}
