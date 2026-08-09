"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  // Lazy-initialized so each client gets its own QueryClient instance
  // instead of sharing one across renders (or, on the server, across
  // requests).
  const [queryClient] = useState(() => new QueryClient());
  return (
    // HeroUI's dark theme only activates via a `.dark` class/attribute, not
    // `prefers-color-scheme` directly, so next-themes applies that class
    // from the system preference. No toggle UI — attribute="class" plus
    // enableSystem keeps this purely system-preference-driven, same as
    // before.
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
