import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Tabs } from "./tabs";

const TABS = [
  { id: "equal", label: "Equal" },
  { id: "exact", label: "Exact" },
  { id: "shares", label: "Shares" },
];

const meta = {
  title: "UI/Tabs",
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstTabActive: Story = {
  args: { tabs: TABS, value: "equal", onChange: () => {}, children: "Equal split panel" },
};

export const MiddleTabActive: Story = {
  args: { tabs: TABS, value: "exact", onChange: () => {}, children: "Exact amounts panel" },
};
