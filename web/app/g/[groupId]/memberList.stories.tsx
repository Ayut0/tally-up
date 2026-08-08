import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { MemberList } from "./memberList";

const members = [
  { id: "m1", name: "Alice" },
  { id: "m2", name: "Bob" },
  { id: "m3", name: "Carol" },
];

/**
 * MemberList's add/remove actions call the real lib/api.ts functions (real
 * `fetch`), and its query invalidation needs a live QueryClient. Storybook
 * has no backend to talk to, so every story stubs `fetch` with canned
 * responses — enough to click through the two-tap confirm-remove flow and
 * the add-member form for real, in isolation. `nonzeroBalanceMemberId`
 * makes DELETE for that one member fail with the same 409 the real server
 * returns, so the "surfaced, not swallowed" error state is reachable too.
 */
function stubFetch(nonzeroBalanceMemberId?: string) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (method === "DELETE") {
      if (nonzeroBalanceMemberId && url.endsWith(`/${nonzeroBalanceMemberId}`)) {
        return new Response(
          JSON.stringify({ error: "member has a nonzero balance; settle up before removing" }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && url.includes("/members")) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return new Response(JSON.stringify({ id: `new-${Date.now()}`, name: body.name }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }) as typeof fetch;
}

const meta = {
  title: "Group/MemberList",
  component: MemberList,
  args: { groupId: "demo-group" },
  decorators: [
    (Story) => {
      const client = new QueryClient();
      return (
        <QueryClientProvider client={client}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
} satisfies Meta<typeof MemberList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: { members },
  beforeEach: () => {
    stubFetch();
  },
};

export const Empty: Story = {
  args: { members: [] },
  beforeEach: () => {
    stubFetch();
  },
};

export const RemoveBlockedByNonzeroBalance: Story = {
  args: { members },
  beforeEach: () => {
    stubFetch("m1");
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const aliceRow = canvas.getByText("Alice").closest("li")!;
    const rowScope = within(aliceRow as HTMLElement);

    await userEvent.click(rowScope.getByRole("button", { name: "Remove" }));
    await userEvent.click(rowScope.getByRole("button", { name: "Confirm remove?" }));

    await waitFor(() =>
      expect(
        rowScope.getByText("member has a nonzero balance; settle up before removing"),
      ).toBeInTheDocument(),
    );
  },
};
