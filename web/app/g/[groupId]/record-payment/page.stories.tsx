import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, HttpResponse, http } from "msw";
import RecordPaymentPage from "./page";

// Same UUID-shaped-id requirement as app/g/[groupId]/page.stories.tsx: the
// fetched group/balance are validated against the real OpenAPI-derived zod
// schemas (zGroupRecord et al., see lib/api.ts), which reject plain
// "m1"-style ids.
const GROUP_ID = "d0000000-0000-4000-8000-000000000000";
const MEMBER_1 = "d0000000-0000-4000-8000-000000000001";
const MEMBER_2 = "d0000000-0000-4000-8000-000000000002";
const MEMBER_3 = "d0000000-0000-4000-8000-000000000003";

const group = {
  id: GROUP_ID,
  name: "Ski Trip",
  members: [
    { id: MEMBER_1, name: "Alice" },
    { id: MEMBER_2, name: "Bob" },
    { id: MEMBER_3, name: "Carol" },
  ],
};

const balance = {
  balances: [
    { member_id: MEMBER_1, balance: -1500 },
    { member_id: MEMBER_2, balance: 1500 },
    { member_id: MEMBER_3, balance: 0 },
  ],
  as_of_seq: 1,
};

// RecordPaymentPage calls useGroupAndBalance -> lib/api.ts's
// getGroup/getBalance directly, so every story mocks those endpoints via
// MSW rather than the page itself, same as app/g/[groupId]/page.stories.tsx.
const groupSucceeds = http.get(`*/groups/${GROUP_ID}`, () => HttpResponse.json(group));
const balanceSucceeds = http.get(`*/groups/${GROUP_ID}/balance`, () =>
  HttpResponse.json(balance),
);

const meta = {
  title: "Pages/RecordPayment",
  component: RecordPaymentPage,
  parameters: {
    // Routing mock (@storybook/nextjs-vite, built in): wraps the story in a
    // real AppRouterContext so useParams() resolves `groupId`.
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: `/g/${GROUP_ID}/record-payment`,
        segments: [["groupId", GROUP_ID]],
      },
    },
  },
} satisfies Meta<typeof RecordPaymentPage>;

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

export const Populated: Story = {
  parameters: { msw: { handlers: [groupSucceeds, balanceSucceeds] } },
};

// The settle-up page's "Different amount" escape hatch links here with
// ?payer=&counterparty= to pre-select both sides of the transfer it was
// about to record — worth its own story since it drives useRecordPaymentForm
// down a different initial-state branch than the plain Populated story
// (initialPayerId/initialCounterpartyId override the getIdentity/balance
// defaults). `navigation.query` round-trips into useSearchParams() via the
// nextjs-vite mock's SearchParamsContext, same mechanism `navigation.segments`
// uses for useParams() above — no extra dependency needed.
export const PopulatedPrefilled: Story = {
  parameters: {
    msw: { handlers: [groupSucceeds, balanceSucceeds] },
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: `/g/${GROUP_ID}/record-payment`,
        segments: [["groupId", GROUP_ID]],
        query: { payer: MEMBER_2, counterparty: MEMBER_3 },
      },
    },
  },
};
