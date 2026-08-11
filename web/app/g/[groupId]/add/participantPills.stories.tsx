import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ParticipantPills } from "./participantPills";

const rows = [
  { id: "m1", name: "Yuto", checked: true },
  { id: "m2", name: "Aya", checked: true },
  { id: "m3", name: "Kenji", checked: true },
  { id: "m4", name: "Mio", checked: true },
];

const meta = {
  title: "AddExpense/ParticipantPills",
  component: ParticipantPills,
  args: { onToggle: () => {} },
} satisfies Meta<typeof ParticipantPills>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllSelected: Story = {
  args: { rows },
};

export const SomeDeselected: Story = {
  args: {
    rows: rows.map((row) =>
      row.id === "m2" || row.id === "m4" ? { ...row, checked: false } : row,
    ),
  },
};
