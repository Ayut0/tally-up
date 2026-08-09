import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { Dialog } from "./dialog";

const meta = {
  title: "Common/Dialog",
  component: Dialog,
  args: {
    open: true,
    onClose: fn(),
    ariaLabel: "Example dialog",
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    children: (
      <div className="flex flex-col gap-4">
        <p>Remove Alice from this group?</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white"
          >
            Remove
          </button>
        </div>
      </div>
    ),
  },
};
