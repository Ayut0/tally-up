import type { Page } from "@playwright/test";

/**
 * Screen 03b — the "You're invited" panel rendered at `/g/{groupId}` when
 * this browser has no identity for the group yet (`JoinPicker` in
 * app/g/[groupId]/join.tsx). Not a separate route: the group URL itself is
 * the invite link (README), so `open()` just navigates there.
 */
export class JoinScreen {
  constructor(private readonly page: Page) {}

  async open(inviteLink: string): Promise<void> {
    await this.page.goto(inviteLink);
  }

  /**
   * Member rows are `Button variant="row"` inside `<li>`s, with the
   * member's name as the accessible name — picking one sets this browser's
   * identity (`setIdentity`) and lands on the group page.
   */
  async pickMember(memberName: string): Promise<void> {
    await this.page.getByRole("button", { name: memberName }).click();
  }
}
