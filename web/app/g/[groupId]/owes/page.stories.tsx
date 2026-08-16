import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, HttpResponse, http } from "msw";
import OwesPage from "./page";

// useOwes's fetched data is validated against the real OpenAPI-derived zod
// schemas (zGroupRecord, zPairwiseBalances — see lib/api.ts), which require
// ids to be UUID-shaped — plain "m1"-style ids fail that contract validation
// and render the page's error branch instead of the intended populated one.
const GROUP_ID = "a0000000-0000-4000-8000-000000000000";
const MEMBER_1 = "a0000000-0000-4000-8000-000000000001";
const MEMBER_2 = "a0000000-0000-4000-8000-000000000002";
const MEMBER_3 = "a0000000-0000-4000-8000-000000000003";

const members = [
  { id: MEMBER_1, name: "Alice" },
  { id: MEMBER_2, name: "Bob" },
  { id: MEMBER_3, name: "Carol" },
];

const group = { id: GROUP_ID, name: "Ski Trip", members };

const populatedPairs = {
  balances: [{ debtor_id: MEMBER_2, creditor_id: MEMBER_1, amount: 1500 }],
};

const emptyPairs = { balances: [] };

// useOwes calls lib/api.ts's getGroup/getPairwiseBalances directly, so every
// story mocks those endpoints via MSW (msw-storybook-addon, wired up in
// .storybook/preview.tsx) rather than the page itself — this exercises the
// real fetch/parse/render path, not a stubbed component.
const groupSucceeds = http.get(`*/groups/${GROUP_ID}`, () => HttpResponse.json(group));

const meta = {
  title: "Pages/Owes",
  component: OwesPage,
  parameters: {
    // Routing mock (@storybook/nextjs-vite, built in): wraps the story in a
    // real AppRouterContext so useParams() resolves, no extra dependency
    // needed alongside MSW's API mocking above.
    nextjs: {
      appDirectory: true,
      navigation: { pathname: `/g/${GROUP_ID}/owes`, segments: [["groupId", GROUP_ID]] },
    },
  },
} satisfies Meta<typeof OwesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  parameters: {
    msw: {
      handlers: [
        groupSucceeds,
        http.get(`*/groups/${GROUP_ID}/pairwise-balances`, () =>
          HttpResponse.json(populatedPairs),
        ),
      ],
    },
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        groupSucceeds,
        http.get(`*/groups/${GROUP_ID}/pairwise-balances`, () => HttpResponse.json(emptyPairs)),
      ],
    },
  },
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
