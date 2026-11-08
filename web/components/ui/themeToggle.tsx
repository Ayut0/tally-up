"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Light/night switch. next-themes persists the choice in localStorage and
 * falls back to the system preference until the user picks one (see
 * providers.tsx). `resolvedTheme` is undefined on the server, so the label
 * is only trusted once mounted — useSyncExternalStore's server snapshot
 * (false) keeps hydration markup identical to the server's.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to night mode"}
      className="flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-ink/[.15] bg-surface text-base text-ink"
    >
      <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
    </button>
  );
}
