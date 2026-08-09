import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Text } from "./text";

const meta = {
  title: "UI/Text",
  component: Text,
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Heading: Story = {
  args: { variant: "heading", children: "Who owes whom" },
};

export const SectionHeading: Story = {
  args: { variant: "section-heading", children: "Balances" },
};

export const Body: Story = {
  args: { variant: "body", children: "Alice" },
};

export const Error: Story = {
  args: { variant: "error", children: "Could not load this group." },
};

export const Muted: Story = {
  args: { variant: "muted", children: "Loading…" },
};
