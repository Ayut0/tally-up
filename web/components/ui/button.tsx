"use client";

import { Button as HeroButton } from "@heroui/react";
import type { ReactNode } from "react";

type ButtonVariant = "solid" | "danger" | "ghost" | "dashed" | "dark";

const VARIANT_MAP: Record<ButtonVariant, "primary" | "danger" | "ghost" | "outline"> = {
  solid: "primary",
  danger: "danger",
  ghost: "ghost",
  dashed: "outline",
  dark: "ghost",
};

/**
 * design-handoff.md's "pressed button" treatment for the "solid"/primary
 * variant, and the dashed-outline "+ add member" affordance (Screen 01) for
 * "dashed" — danger/ghost aren't specced by the handoff and stay on
 * HeroUI's defaults. HeroUI's Button merges this className with its own
 * variant classes via tailwind-merge (see composeTwRenderProps), so later,
 * more specific utilities here win over the base rounded-3xl/px-4 HeroUI
 * ships — "dashed" overrides HeroUI's solid-bordered "outline" variant's
 * border-style/color/bg/typography the same way "solid" overrides
 * "primary"'s.
 */
const PRESSED_BUTTON_CLASS_NAME =
  "rounded-button p-[17px] min-h-[52px] text-[17px] font-extrabold shadow-pressed";

const DASHED_BUTTON_CLASS_NAME =
  "rounded-field border-[1.5px] border-dashed border-ink/[.3] bg-transparent p-[13px] text-[14px] font-bold text-ink/[.6]";

/**
 * design-handoff.md's ink-bg/white-text pill — the invite banner's "Copy
 * link" is the only place the handoff uses it. Built on the "ghost" base
 * (bg/fg start transparent) and pins button.css's own `--button-bg{,-hover,
 * -pressed}`/`--button-fg` custom properties directly, the same mechanism
 * its other color variants use (see @heroui/styles' button.styles.ts) —
 * this is a "dark" variant in this wrapper's own vocabulary, not a HeroUI
 * variant name.
 */
const DARK_PILL_CLASS_NAME =
  "[--button-bg:var(--foreground)] [--button-bg-hover:var(--foreground)] [--button-bg-pressed:var(--foreground)] [--button-fg:var(--background)] rounded-[10px] px-[14px] py-[10px] min-h-[38px] text-[12.5px] font-extrabold";

const EXTRA_CLASS_NAME: Partial<Record<ButtonVariant, string>> = {
  solid: PRESSED_BUTTON_CLASS_NAME,
  dashed: DASHED_BUTTON_CLASS_NAME,
  dark: DARK_PILL_CLASS_NAME,
};

/**
 * Curated wrapper over HeroUI's Button: `onClick` is this app's name for
 * the handler since every call site already thinks in those terms, even
 * though the underlying react-aria-components Button only accepts
 * `onPress` (a zero-arg callback satisfies its `(PressEvent) => void`
 * type, so no adapter is needed). `type="submit"` still triggers native
 * form submission regardless of `onPress` wiring, since this renders a
 * real `<button>`.
 */
export function Button({
  variant,
  type = "button",
  disabled,
  fullWidth,
  onClick,
  "aria-label": ariaLabel,
  children,
}: {
  variant: ButtonVariant;
  type?: "button" | "submit";
  disabled?: boolean;
  fullWidth?: boolean;
  onClick?: () => void;
  "aria-label"?: string;
  children: ReactNode;
}) {
  return (
    <HeroButton
      variant={VARIANT_MAP[variant]}
      type={type}
      isDisabled={disabled}
      fullWidth={fullWidth}
      onPress={onClick}
      aria-label={ariaLabel}
      className={EXTRA_CLASS_NAME[variant]}
    >
      {children}
    </HeroButton>
  );
}
