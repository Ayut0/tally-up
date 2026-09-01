import { test as base } from "playwright-bdd";
import { AddExpenseScreen } from "../screens/addExpenseScreen";
import { GroupScreen } from "../screens/groupScreen";
import { HomeScreen } from "../screens/homeScreen";
import { JoinScreen } from "../screens/joinScreen";
import { MembersScreen } from "../screens/membersScreen";
import { OwesScreen } from "../screens/owesScreen";

/**
 * Screens are handed to steps as Playwright fixtures rather than constructed
 * inside each step. Two reasons: a step body stays a single expressive line,
 * and a screen is built lazily — a scenario that never reaches the
 * add-expense form never constructs `AddExpenseScreen`.
 *
 * Every step file imports `test` from here (never from `@playwright/test` or
 * `playwright-bdd` directly), so all steps share one fixture set.
 */
type Screens = {
  home: HomeScreen;
  group: GroupScreen;
  addExpense: AddExpenseScreen;
  members: MembersScreen;
  owes: OwesScreen;
  secondPhone: Phone;
};

/**
 * A second browser's screen set — the shared prerequisite for every
 * multi-phone scenario (issue #277: this story, and stories 3/7 and 7/7
 * after it). Bundled as one fixture rather than several (`secondPage`,
 * `secondGroup`, …) so a new multi-phone scenario reaches for one thing and
 * gets a screen set that mirrors the default context's.
 */
export type Phone = {
  home: HomeScreen;
  group: GroupScreen;
  addExpense: AddExpenseScreen;
  join: JoinScreen;
};

export const test = base.extend<Screens>({
  home: async ({ page }, use) => {
    await use(new HomeScreen(page));
  },
  group: async ({ page }, use) => {
    await use(new GroupScreen(page));
  },
  addExpense: async ({ page }, use) => {
    await use(new AddExpenseScreen(page));
  },
  members: async ({ page }, use) => {
    await use(new MembersScreen(page));
  },
  owes: async ({ page }, use) => {
    await use(new OwesScreen(page));
  },
  // `browser.newContext()` gets its own cookie jar and storage partition,
  // unrelated to the default `page`'s context — so this phone never carries
  // the first phone's `localStorage` identity, no matter whether it's
  // created before or after the group exists (issue #277's isolation
  // gotcha). Closed after the test so a scenario that never uses it doesn't
  // leak a browser context either.
  secondPhone: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await use({
      home: new HomeScreen(page),
      group: new GroupScreen(page),
      addExpense: new AddExpenseScreen(page),
      join: new JoinScreen(page),
    });
    await context.close();
  },
});

export { expect } from "@playwright/test";
