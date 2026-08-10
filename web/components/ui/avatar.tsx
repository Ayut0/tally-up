"use client";

import { Avatar as HeroAvatar } from "@heroui/react";

/**
 * design-handoff.md's per-member pastel palette (Design Tokens > Colors >
 * "Avatar pastels"): 4 fixed oklch hue/text pairs. Not promoted to a CSS
 * custom property per pair — this is a closed palette with exactly one
 * consumer (this component), so a local array is the "one source of
 * truth" the issue's AC asks for without adding 8 global tokens nothing
 * else reads.
 */
const PASTELS: { bg: string; text: string }[] = [
  { bg: "oklch(0.85 0.06 60)", text: "#6d4520" },
  { bg: "oklch(0.85 0.06 150)", text: "#3c5c3f" },
  { bg: "oklch(0.85 0.06 250)", text: "#3a4e6b" },
  { bg: "oklch(0.85 0.06 340)", text: "#6b3a55" },
];

/**
 * Deterministic: same `memberId` always sums to the same char-code total,
 * so a member's color stays stable across reloads/re-fetches — keyed on
 * the stable id, not the display name, on purpose.
 */
export function pickPastel(memberId: string): { bg: string; text: string } {
  const sum = Array.from(memberId).reduce((total, char) => total + char.charCodeAt(0), 0);
  return PASTELS[sum % PASTELS.length]!;
}

export function Avatar({
  memberId,
  initial,
  size = 32,
}: {
  memberId: string;
  initial: string;
  size?: number;
}) {
  const { bg, text } = pickPastel(memberId);
  return (
    <HeroAvatar.Root style={{ width: size, height: size }}>
      <HeroAvatar.Fallback
        className="flex items-center justify-center rounded-full font-extrabold"
        style={{ backgroundColor: bg, color: text, fontSize: Math.round(size * 0.43) }}
      >
        {initial}
      </HeroAvatar.Fallback>
    </HeroAvatar.Root>
  );
}
