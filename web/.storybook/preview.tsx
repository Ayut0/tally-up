import type { Preview } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mswLoader } from "msw-storybook-addon/csf3";
import { useState } from "react";
import "../app/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  // Story-level network mocking (msw/msw-storybook-addon): components stub
  // their fetches via each story's `parameters.msw` handlers instead of a
  // hand-rolled `globalThis.fetch` override, which needs no `as`-casts to
  // satisfy `typeof fetch`.
  loaders: [mswLoader()],
  // Every story runs inside a fresh QueryClient, declared once here rather
  // than per story file, for any component that reads TanStack Query
  // context (e.g. MemberList's useAddMember/useRemoveMember).
  decorators: [
    (Story) => {
      const [client] = useState(() => new QueryClient());
      return (
        <QueryClientProvider client={client}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
};

export default preview;
