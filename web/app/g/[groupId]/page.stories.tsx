import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, HttpResponse, http } from "msw";
import { setIdentity } from "@/lib/identity";
import GroupPage from "./page";

// GroupPage's fetched data is validated against the real OpenAPI-derived
// zod schemas (zGroupRecord et al., see lib/api.ts), which require ids to
// be UUID-shaped — plain "m1"-style ids fail that contract validation and
// render the page's error branch instead of the intended populated one.
const GROUP_ID = "a0000000-0000-4000-8000-000000000000";
const MEMBER_1 = "a0000000-0000-4000-8000-000000000001";
const MEMBER_2 = "a0000000-0000-4000-8000-000000000002";
const MEMBER_3 = "a0000000-0000-4000-8000-000000000003";
const ENTRY_1 = "a0000000-0000-4000-8000-0000000000e1";

const members = [
  { id: MEMBER_1, name: "Alice" },
  { id: MEMBER_2, name: "Bob" },
  { id: MEMBER_3, name: "Carol" },
];

const group = { id: GROUP_ID, name: "Ski Trip", members };

const balance = {
  balances: [
    { member_id: MEMBER_1, balance: 1500 },
    { member_id: MEMBER_2, balance: -1500 },
    { member_id: MEMBER_3, balance: 0 },
  ],
  as_of_seq: 1,
};

const entries = {
  entries: [
    {
      id: ENTRY_1,
      seq: 1,
      kind: "expense",
      payer_id: MEMBER_1,
      total_amount: 3000,
      participants: [MEMBER_1, MEMBER_2, MEMBER_3],
      memo: "Lift tickets",
      occurred_on: "2026-08-01",
      created_by: MEMBER_1,
      created_at: "2026-08-01T09:00:00Z",
      postings: [
        { member_id: MEMBER_1, amount: 2000 },
        { member_id: MEMBER_2, amount: -1000 },
        { member_id: MEMBER_3, amount: -1000 },
      ],
    },
  ],
};

// GroupPage calls useGroupData -> lib/api.ts's getGroup/getBalance/listEntries
// directly, so every story mocks those endpoints via MSW (msw-storybook-addon,
// wired up in .storybook/preview.tsx) rather than the page itself — this
// exercises the real fetch/parse/render path, not a stubbed component.
const groupSucceeds = http.get(`*/groups/${GROUP_ID}`, () => HttpResponse.json(group));
const balanceSucceeds = http.get(`*/groups/${GROUP_ID}/balance`, () => HttpResponse.json(balance));
const entriesSucceeds = http.get(`*/groups/${GROUP_ID}/entries`, () => HttpResponse.json(entries));

const meta = {
  title: "Pages/Group",
  component: GroupPage,
  parameters: {
    // Routing mock (@storybook/nextjs-vite, built in): wraps the story in a
    // real AppRouterContext so useParams()/next/link resolve, no extra
    // dependency needed alongside MSW's API mocking above.
    nextjs: {
      appDirectory: true,
      navigation: { pathname: `/g/${GROUP_ID}`, segments: [["groupId", GROUP_ID]] },
    },
  },
} satisfies Meta<typeof GroupPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  beforeEach: () => {
    setIdentity(GROUP_ID, MEMBER_1);
  },
  parameters: { msw: { handlers: [groupSucceeds, balanceSucceeds, entriesSucceeds] } },
};

export const JoinPicker: Story = {
  beforeEach: () => {
    // lib/identity.ts's storage key format is private to that module, so
    // clear everything rather than reconstruct it here.
    window.localStorage.clear();
  },
  parameters: { msw: { handlers: [groupSucceeds, balanceSucceeds, entriesSucceeds] } },
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
