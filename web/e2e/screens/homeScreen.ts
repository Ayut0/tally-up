import type { Page } from "@playwright/test";

/**
 * Screen 01 — the create-group form at `/` (app/page.tsx).
 *
 * A "screen" is this suite's page object: the only layer that knows about
 * selectors and DOM structure. Steps call methods here; they never touch
 * `page` directly. See e2e/README.md.
 */
export class HomeScreen {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/");
  }

  /**
   * Fills the form and submits. The form renders five blank member rows and
   * silently drops the empty ones at submit (useCreateGroupForm), so fewer
   * names than rows is the normal case, not a special one.
   *
   * Order matters to the domain, not just the UI: the server builds
   * `GroupRecord.members` from `member_names` in order, so `memberNames[0]`
   * becomes the creator — the member this browser is then remembered as.
   */
  async createGroup(groupName: string, memberNames: string[]): Promise<void> {
    await this.page.getByLabel("Group name").fill(groupName);

    for (const [index, memberName] of memberNames.entries()) {
      await this.page.getByLabel(`Member ${index + 1} name`).fill(memberName);
    }

    await this.page.getByRole("button", { name: "Create group" }).click();

    // Submitting navigates to /g/<uuid>. Waiting on the URL here (rather than
    // in the caller) keeps "created a group" a complete, settled action.
    await this.page.waitForURL(/\/g\/[0-9a-f-]{36}$/);
  }
}
