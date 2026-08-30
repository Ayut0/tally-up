import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/**
 * Screen 02 — the "You're invited" panel rendered at `/g/{groupId}` when
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
   * A syntactically valid group id nothing created — for the broken-link
   * scenario, where the group page itself (not JoinPicker) has to render
   * the API's 404 (GET /groups/{id}).
   */
  async openBrokenLink(): Promise<void> {
    await this.page.goto(`/g/${randomUUID()}`);
  }

  /**
   * Member rows are `Button variant="row"` inside `<li>`s, with the
   * member's name as the accessible name — picking one sets this browser's
   * identity (`setIdentity`) and lands on the group page.
   */
  async pickMember(memberName: string): Promise<void> {
    await this.page.getByRole("button", { name: memberName }).click();
  }

  /**
   * The instruction line only JoinPicker renders — used to confirm a
   * browser is still being asked (e.g. after reopening the link without
   * having picked yet), as distinct from `GroupScreen.expectOnGroupPage`.
   */
  async expectShown(): Promise<void> {
    await expect(
      this.page.getByText("Who are you? Pick your name once — this phone will remember."),
    ).toBeVisible();
  }
}
