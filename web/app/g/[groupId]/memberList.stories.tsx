import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { zAddMemberRequest } from "@/lib/api-schemas/zod.gen";
import { MemberList } from "./memberList";

const members = [
  { id: "m1", name: "Alice" },
  { id: "m2", name: "Bob" },
  { id: "m3", name: "Carol" },
];

// MemberList's add/remove actions call the real lib/api.ts functions, so
// each story mocks the network with MSW (msw-storybook-addon, wired up in
// .storybook/preview.tsx) rather than the component itself — enough to
// click through the confirm-remove dialog and the add-member form for
// real, in isolation.
const addMemberSucceeds = http.post("*/groups/:groupId/members", async ({ request }) => {
  const { name } = zAddMemberRequest.parse(await request.json());
  return HttpResponse.json({ id: `new-${Date.now()}`, name }, { status: 201 });
});

const removeMemberSucceeds = http.delete("*/groups/:groupId/members/:memberId", () => {
  return new HttpResponse(null, { status: 204 });
});

/** Blocks removal of one specific member with the same 409 the real server returns for a nonzero balance; every other member still removes cleanly. */
function removeMemberBlockedFor(nonzeroBalanceMemberId: string) {
  return http.delete("*/groups/:groupId/members/:memberId", ({ params }) => {
    if (params.memberId !== nonzeroBalanceMemberId) {
      return new HttpResponse(null, { status: 204 });
    }
    return HttpResponse.json(
      { error: "member has a nonzero balance; settle up before removing" },
      { status: 409 },
    );
  });
}

const meta = {
  title: "Group/MemberList",
  component: MemberList,
  args: { groupId: "demo-group" },
} satisfies Meta<typeof MemberList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: { members },
  parameters: { msw: { handlers: [addMemberSucceeds, removeMemberSucceeds] } },
};

export const Empty: Story = {
  args: { members: [] },
  parameters: { msw: { handlers: [addMemberSucceeds, removeMemberSucceeds] } },
};

export const RemoveBlockedByNonzeroBalance: Story = {
  args: { members },
  parameters: { msw: { handlers: [removeMemberBlockedFor("m1")] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const aliceRow = canvas.getByText("Alice").closest("li");
    if (!aliceRow) throw new Error("expected an <li> ancestor for Alice's row");

    await userEvent.click(within(aliceRow).getByRole("button", { name: "Remove" }));
    // The confirm dialog isn't scoped inside Alice's row — it's one shared
    // dialog for the whole list — so its confirm button needs a name that
    // won't collide with the row's own "Remove" button.
    await userEvent.click(canvas.getByRole("button", { name: "Remove Alice" }));

    await waitFor(() =>
      expect(
        canvas.getByText("member has a nonzero balance; settle up before removing"),
      ).toBeInTheDocument(),
    );
  },
};
