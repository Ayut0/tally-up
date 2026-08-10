import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Avatar } from "./avatar";

const meta = {
  title: "UI/Avatar",
  component: Avatar,
  args: { memberId: "member-a", initial: "Y" },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HueA: Story = { args: { memberId: "member-a", initial: "Y" } };
export const HueB: Story = { args: { memberId: "member-b", initial: "A" } };
export const HueC: Story = { args: { memberId: "member-c", initial: "K" } };
export const HueD: Story = { args: { memberId: "member-d", initial: "M" } };

export const Small: Story = { args: { size: 28 } };
export const Large: Story = { args: { size: 38 } };
