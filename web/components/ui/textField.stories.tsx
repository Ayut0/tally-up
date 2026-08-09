import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TextField } from "./textField";

const meta = {
  title: "UI/TextField",
  component: TextField,
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Total (¥)", type: "number", placeholder: "0" },
};

export const WithError: Story = {
  args: {
    label: "Total (¥)",
    type: "number",
    placeholder: "0",
    error: "Enter an amount greater than zero.",
  },
};
