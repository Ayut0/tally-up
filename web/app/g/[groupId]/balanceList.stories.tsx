import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { buildBalanceRows } from "@/lib/balance";
import { BalanceList } from "./balanceList";

const members = [
  { id: "m1", name: "Alice" },
  { id: "m2", name: "Bob" },
  { id: "m3", name: "Carol" },
];

const meta = {
  title: "Group/BalanceList",
  component: BalanceList,
  args: { groupId: "demo-group" },
} satisfies Meta<typeof BalanceList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedBalances: Story = {
  args: {
    rows: buildBalanceRows(members, [
      { member_id: "m1", balance: 1500 },
      { member_id: "m2", balance: -1500 },
      { member_id: "m3", balance: 0 },
    ]),
  },
};

export const AllSettled: Story = {
  args: {
    rows: buildBalanceRows(members, [
      { member_id: "m1", balance: 0 },
      { member_id: "m2", balance: 0 },
      { member_id: "m3", balance: 0 },
    ]),
  },
};

export const Empty: Story = {
  args: { rows: [] },
};

export const WithCurrentMember: Story = {
  args: {
    rows: buildBalanceRows(members, [
      { member_id: "m1", balance: 1500 },
      { member_id: "m2", balance: -1500 },
      { member_id: "m3", balance: 0 },
    ]),
    currentMemberId: "m1",
  },
};
