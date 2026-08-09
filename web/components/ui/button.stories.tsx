import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Solid: Story = {
  args: { variant: "solid", children: "Add expense" },
};

export const Danger: Story = {
  args: { variant: "danger", children: "Remove" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Cancel" },
};

export const Disabled: Story = {
  args: { variant: "solid", disabled: true, children: "Add expense" },
};
