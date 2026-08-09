import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { TwoTapConfirm } from "./twoTapConfirm";

const meta = {
  title: "Common/TwoTapConfirm",
  component: TwoTapConfirm,
  args: {
    actionLabel: "Remove",
    confirmLabel: "Confirm remove?",
    pendingLabel: "Removing…",
    onRequest: fn(),
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof TwoTapConfirm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  args: { confirming: false, pending: false },
};

export const Confirming: Story = {
  args: { confirming: true, pending: false },
};

export const Pending: Story = {
  args: { confirming: true, pending: true },
};
