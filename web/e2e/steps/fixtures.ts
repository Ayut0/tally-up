import { test as base } from "playwright-bdd";
import { AddExpenseScreen } from "../screens/addExpenseScreen";
import { GroupScreen } from "../screens/groupScreen";
import { HomeScreen } from "../screens/homeScreen";

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
});

export { expect } from "@playwright/test";
