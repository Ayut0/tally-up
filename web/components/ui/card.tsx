"use client";

import { Card as HeroCard } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * The handoff's recurring card surface (member rows, balance/history
 * cards, the add-expense fields' bordered boxes): white surface, 1.5px
 * ink-alpha border, 16px radius. Structural only — padding/gap between a
 * card's own contents is a per-screen concern left to call sites in the
 * screen-skinning slices (#51-#56), not this shared primitive.
 */
export function Card({ children }: { children: ReactNode }) {
  return (
    <HeroCard.Root className="rounded-card border-[1.5px] border-ink/[.12] bg-surface">
      {children}
    </HeroCard.Root>
  );
}
