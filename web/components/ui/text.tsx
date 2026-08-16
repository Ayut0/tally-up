import { Heading, Paragraph, cn } from "@heroui/react";
import type { ReactNode } from "react";

type TextVariant =
  | "heading"
  | "section-heading"
  | "label"
  | "wordmark"
  | "subhead"
  | "body"
  | "error"
  | "muted";

const VARIANT_CLASS_NAME: Record<TextVariant, string> = {
  heading: "text-xl font-semibold text-zinc-950 dark:text-zinc-50",
  "section-heading": "text-sm font-medium text-zinc-700 dark:text-zinc-300",
  // design-handoff.md's uppercase section-label primitive (issue #50): a
  // new variant rather than restyling "section-heading" in place, since
  // that variant is already live on TextField/Select field labels in
  // screens this issue doesn't skin — see design-tokens plan for #50.
  label: "text-ink/[.55] text-xs font-bold tracking-[.06em] uppercase",
  // The "tally-up" wordmark lockup (wordmark.tsx) — its own variant per
  // review feedback on #50, rather than a raw <span> at the call site.
  wordmark: "text-[26px] leading-none font-extrabold tracking-[-.02em] text-ink",
  // Screen 01's subhead line (design-handoff.md §1) — Karla 500 14.5px,
  // ink at 60% — no existing variant matches this exact size/weight/color.
  subhead: "text-[14.5px] font-medium text-ink/[.6]",
  body: "text-base text-zinc-950 dark:text-zinc-50",
  // globals.css's --negative (issue #143) — the handoff's own token for
  // "in the red", not an arbitrary Tailwind red. Light-only, like every
  // other handoff token in that file: no dark-mode counterpart exists.
  error: "text-sm text-negative",
  muted: "text-sm text-zinc-500",
};

/**
 * Curated wrapper over HeroUI's Heading/Paragraph: picks the semantically
 * correct element per variant (h1, h2, or p) while keeping this app's
 * existing visual sizes/colors verbatim via className rather than
 * switching to HeroUI's own color tokens — tailwind-variants' twMerge
 * resolves the className override deterministically against Heading's/
 * Paragraph's internal variant classes, so this isn't a fragile override.
 * Adopting HeroUI's color system itself is a separate decision from this
 * migration (#197's "no visual redesign" scope).
 *
 * These 8 variants cover this app's heading/label/body/error/muted text —
 * they're not meant to grow a one-off variant per unique className a page
 * has ever used. Dense, design-handoff-specced microtypography (e.g. a
 * bolded mono amount column) that doesn't cleanly fit one of these picks
 * whichever variant is the closest semantic/element match and overrides its
 * sizing via the optional `className` (merged, not concatenated, via `cn` —
 * same twMerge-backed override the variants themselves rely on) rather than
 * reaching for HeroUI's `Heading`/`Paragraph` directly at the call site or
 * growing a new narrow variant here.
 */
export function Text({
  variant,
  className,
  children,
}: {
  variant: TextVariant;
  className?: string;
  children: ReactNode;
}) {
  const combinedClassName = cn(VARIANT_CLASS_NAME[variant], className);
  if (variant === "heading") {
    return (
      <Heading level={1} className={combinedClassName}>
        {children}
      </Heading>
    );
  }
  if (variant === "section-heading") {
    return (
      <Heading level={2} className={combinedClassName}>
        {children}
      </Heading>
    );
  }
  const size = variant === "body" ? "base" : "sm";
  return (
    <Paragraph size={size} className={combinedClassName}>
      {children}
    </Paragraph>
  );
}
