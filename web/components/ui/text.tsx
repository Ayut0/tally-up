import { Heading, Paragraph } from "@heroui/react";
import type { ReactNode } from "react";

type TextVariant =
  | "heading"
  | "section-heading"
  | "label"
  | "wordmark"
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
  body: "text-base text-zinc-950 dark:text-zinc-50",
  error: "text-sm text-red-600 dark:text-red-400",
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
 * These 7 variants cover this app's heading/label/body/error/muted text —
 * they're not meant to grow a one-off variant per unique className a page
 * has ever used. Dense list-row microtypography (e.g. a bolded amount
 * column) that doesn't cleanly fit one of these is left as plain Tailwind
 * at the call site rather than forcing a new narrow variant here.
 */
export function Text({ variant, children }: { variant: TextVariant; children: ReactNode }) {
  const className = VARIANT_CLASS_NAME[variant];
  if (variant === "heading") {
    return (
      <Heading level={1} className={className}>
        {children}
      </Heading>
    );
  }
  if (variant === "section-heading") {
    return (
      <Heading level={2} className={className}>
        {children}
      </Heading>
    );
  }
  const size = variant === "body" ? "base" : "sm";
  return (
    <Paragraph size={size} className={className}>
      {children}
    </Paragraph>
  );
}
