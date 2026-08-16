import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { setIdentity } from "@/lib/identity";
import SettlePage from "./page";

// Same UUID-shaped-id requirement as app/g/[groupId]/page.stories.tsx: the
// fetched group is validated against the real OpenAPI-derived zod schema
// (zGroupRecord et al., see lib/api.ts), which rejects plain "m1"-style ids.
const GROUP_ID = "c0000000-0000-4000-8000-000000000000";
const MEMBER_1 = "c0000000-0000-4000-8000-000000000001";
const MEMBER_2 = "c0000000-0000-4000-8000-000000000002";
const MEMBER_3 = "c0000000-0000-4000-8000-000000000003";
const NEW_ENTRY_ID = "c0000000-0000-4000-8000-0000000000e1";

const group = {
  id: GROUP_ID,
  name: "Ski Trip",
  members: [
    { id: MEMBER_1, name: "Alice" },
    { id: MEMBER_2, name: "Bob" },
    { id: MEMBER_3, name: "Carol" },
  ],
};

const emptyPlan = { transfers: [], as_of_seq: 1 };

const populatedPlan = {
  transfers: [
    { from: MEMBER_2, to: MEMBER_1, amount: 1500 },
    { from: MEMBER_3, to: MEMBER_1, amount: 500 },
  ],
  as_of_seq: 1,
};

// SettlePage calls useSettlePlan/useRecordTransfer -> lib/api.ts's
// getGroup/getSettlePlan/addEntry directly, so every story mocks those
// endpoints via MSW (msw-storybook-addon, wired up in .storybook/preview.tsx)
// rather than the page itself, same as app/g/[groupId]/page.stories.tsx.
const groupSucceeds = http.get(`*/groups/${GROUP_ID}`, () => HttpResponse.json(group));
const emptyPlanSucceeds = http.get(`*/groups/${GROUP_ID}/settle-plan`, () =>
  HttpResponse.json(emptyPlan),
);
const populatedPlanSucceeds = http.get(`*/groups/${GROUP_ID}/settle-plan`, () =>
  HttpResponse.json(populatedPlan),
);

const meta = {
  title: "Pages/Settle",
  component: SettlePage,
  parameters: {
    // Routing mock (@storybook/nextjs-vite, built in): wraps the story in a
    // real AppRouterContext so useParams() resolves `groupId`.
    nextjs: {
      appDirectory: true,
      navigation: { pathname: `/g/${GROUP_ID}/settle`, segments: [["groupId", GROUP_ID]] },
    },
  },
} satisfies Meta<typeof SettlePage>;

export default meta;
type Story = StoryObj<typeof meta>;

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

export const Empty: Story = {
  beforeEach: () => {
    setIdentity(GROUP_ID, MEMBER_1);
  },
  parameters: { msw: { handlers: [groupSucceeds, emptyPlanSucceeds] } },
};

export const Populated: Story = {
  beforeEach: () => {
    setIdentity(GROUP_ID, MEMBER_1);
  },
  parameters: { msw: { handlers: [groupSucceeds, populatedPlanSucceeds] } },
};

// "Mark paid" is a multi-step interaction (click -> mocked write -> button
// reads "Recording…" -> every *other* row's button disables -> settles back
// once the plan recomputes) rather than a single-state render, which is
// exactly ADR 0005's bar for adding a `play` function: verified here the
// same way memberList.stories.tsx's RemoveBlockedByNonzeroBalance verifies
// its own multi-step flow. The write handler is delayed so the pending
// state is actually observable instead of racing past the assertion.
const recordTransferSucceeds = http.post(`*/groups/${GROUP_ID}/entries`, async () => {
  await delay(50);
  return HttpResponse.json({ id: NEW_ENTRY_ID, seq: 2 }, { status: 201 });
});

export const MarkPaid: Story = {
  beforeEach: () => {
    setIdentity(GROUP_ID, MEMBER_1);
  },
  parameters: {
    msw: { handlers: [groupSucceeds, populatedPlanSucceeds, recordTransferSucceeds] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Query buttons directly by their accessible name rather than finding a
    // row first: SettlePage's row text interleaves nameOf(transfer.from) with
    // a sibling <span>pays</span> and more text, so "Bob" is never a single
    // element's full text content and getByText("Bob") can't match it — the
    // button's aria-label ("Mark paid: Bob pays Alice ¥1,500") already
    // uniquely identifies the row without that detour.
    const bobButton = await canvas.findByRole("button", { name: /Mark paid: Bob pays Alice/ });
    const carolButton = canvas.getByRole("button", { name: /Mark paid: Carol pays Alice/ });

    await userEvent.click(bobButton);

    await waitFor(() => expect(bobButton).toHaveTextContent("Recording…"));
    expect(carolButton).toBeDisabled();

    await waitFor(() => expect(bobButton).toHaveTextContent("Mark paid"));
    await waitFor(() => expect(carolButton).not.toBeDisabled());
  },
};
