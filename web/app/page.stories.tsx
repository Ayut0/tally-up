import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import Home from "./page";

// Home has no fetch on mount, so its only states worth eyeballing in
// isolation are the initial empty form and the inline error banner shown
// after a failed createGroup submit — the latter is reachable only through
// interaction, so SubmitError drives it with a play function (same shape as
// memberList.stories.tsx's RemoveBlockedByNonzeroBalance).
const submitFails = http.post("*/groups", () =>
  // Message borrowed from the real backend validation rule
  // (internal/application/creategroup/creategroup.go) for authenticity.
  HttpResponse.json({ error: "name must be 1-100 characters" }, { status: 400 }),
);

const meta = {
  title: "Pages/Home",
  component: Home,
  parameters: {
    // Home calls useRouter() from next/navigation unconditionally, so the
    // App Router mock needs enabling even though this page reads no route
    // params/pathname (unlike app/g/[groupId]/page.stories.tsx, no
    // `navigation` sub-object is needed here).
    nextjs: { appDirectory: true },
  },
} satisfies Meta<typeof Home>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SubmitError: Story = {
  parameters: { msw: { handlers: [submitFails] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Group name"), "Kyoto trip");
    await userEvent.type(canvas.getByLabelText("Member 1 name"), "Alice");
    await userEvent.click(canvas.getByRole("button", { name: "Create group" }));

    await waitFor(() =>
      expect(canvas.getByText("name must be 1-100 characters")).toBeInTheDocument(),
    );
  },
};
