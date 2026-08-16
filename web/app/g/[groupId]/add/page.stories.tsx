import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import AddExpensePage from "./page";

// Same UUID-shaped-id requirement as app/g/[groupId]/page.stories.tsx: the
// fetched group is validated against the real OpenAPI-derived zod schema
// (zGroupRecord et al., see lib/api.ts), which rejects plain "m1"-style ids.
const GROUP_ID = "b0000000-0000-4000-8000-000000000000";
const MEMBER_1 = "b0000000-0000-4000-8000-000000000001";
const MEMBER_2 = "b0000000-0000-4000-8000-000000000002";
const MEMBER_3 = "b0000000-0000-4000-8000-000000000003";

const group = {
  id: GROUP_ID,
  name: "Ski Trip",
  members: [
    { id: MEMBER_1, name: "Alice" },
    { id: MEMBER_2, name: "Bob" },
    { id: MEMBER_3, name: "Carol" },
  ],
};

// AddExpensePage calls useGroup -> lib/api.ts's getGroup directly, so every
// story mocks that endpoint via MSW rather than the page itself, same as
// app/g/[groupId]/page.stories.tsx.
const groupSucceeds = http.get(`*/groups/${GROUP_ID}`, () => HttpResponse.json(group));

const meta = {
  title: "Pages/AddExpense",
  component: AddExpensePage,
  parameters: {
    // Routing mock (@storybook/nextjs-vite, built in): wraps the story in a
    // real AppRouterContext so useParams() resolves `groupId`.
    nextjs: {
      appDirectory: true,
      navigation: { pathname: `/g/${GROUP_ID}/add`, segments: [["groupId", GROUP_ID]] },
    },
  },
} satisfies Meta<typeof AddExpensePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  parameters: { msw: { handlers: [groupSucceeds] } },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`*/groups/${GROUP_ID}`, async () => {
          await delay("infinite");
        }),
      ],
    },
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`*/groups/${GROUP_ID}`, () =>
          HttpResponse.json({ error: "group not found" }, { status: 404 }),
        ),
      ],
    },
  },
};

// Exact/Shares/Percent are only reachable by clicking their tab — `mode`
// lives in useAddExpenseForm's own useState, with no prop/query-param
// override — so each variant's play function doubles as an integration
// check that AddExpensePage's click really drives useAddExpenseForm into
// SplitModeSection's other panels. (splitModeSection.stories.tsx's own
// fixtures pass a no-op `setMode`, so they can't exercise that wiring.)
// findByRole (not getByRole) because the group fetch is still in flight on
// first render — AddExpensePage shows "Loading…" until it resolves, so the
// tab isn't in the DOM yet; findByRole retries until MSW's response lands.
async function clickSplitTab(canvasElement: HTMLElement, name: "Exact" | "Shares" | "Percent") {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("tab", { name }));
  return canvas;
}

export const PopulatedExact: Story = {
  parameters: { msw: { handlers: [groupSucceeds] } },
  play: async ({ canvasElement }) => {
    const canvas = await clickSplitTab(canvasElement, "Exact");
    await waitFor(() =>
      expect(
        canvas.getByText("Enter each person's exact amount. Must add up to the total."),
      ).toBeInTheDocument(),
    );
  },
};

export const PopulatedShares: Story = {
  parameters: { msw: { handlers: [groupSucceeds] } },
  play: async ({ canvasElement }) => {
    const canvas = await clickSplitTab(canvasElement, "Shares");
    await waitFor(() =>
      expect(
        canvas.getByText("Weight by shares — e.g. a couple counts as 2. Amounts reflow live."),
      ).toBeInTheDocument(),
    );
  },
};

export const PopulatedPercent: Story = {
  parameters: { msw: { handlers: [groupSucceeds] } },
  play: async ({ canvasElement }) => {
    const canvas = await clickSplitTab(canvasElement, "Percent");
    await waitFor(() =>
      expect(
        canvas.getByText(
          "Percentages must total 100. The preview shows the exact yen booked — rounding included.",
        ),
      ).toBeInTheDocument(),
    );
  },
};
