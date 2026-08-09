import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Dialog } from "./dialog";

const meta = {
  title: "Common/Dialog",
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    "aria-label": "Example dialog",
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
  // Dialog is pure UI with no "open" prop — it only opens because
  // something calls showModal() on its ref, same as any real caller
  // (useRemoveMember) does. The guard makes this idempotent regardless of
  // how many times the ref callback re-fires.
  render: (args) => (
    <Dialog
      {...args}
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
    />
  ),
};
