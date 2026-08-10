"use client";

import { Chip } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * The handoff's pill badge (only instance today: the "YOU" tag on Screen
 * 01's member rows) — generic rather than YOU-specific so a later slice
 * can reuse it for another pill without a new component. Wraps HeroUI's
 * Chip, which is already pill-shaped; className overrides its default
 * bg/size/font down to the handoff's exact highlight treatment.
 */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <Chip className="rounded-full bg-highlight px-[8px] py-[4px] font-mono text-[10.5px] font-bold text-highlight-text-strong">
      {children}
    </Chip>
  );
}
