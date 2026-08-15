"use client";

import { Button as HeroButton } from "@heroui/react";
import type { ReactNode } from "react";

type ButtonVariant =
  | "solid"
  | "danger"
  | "ghost"
  | "dashed"
  | "dark"
  | "pillSelected"
  | "pillUnselected"
  | "row"
  | "stepper";

const VARIANT_MAP: Record<ButtonVariant, "primary" | "danger" | "ghost" | "outline"> = {
  solid: "primary",
  danger: "danger",
  ghost: "ghost",
  dashed: "outline",
  dark: "ghost",
  pillSelected: "ghost",
  pillUnselected: "ghost",
  row: "outline",
  stepper: "outline",
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

/**
 * design-handoff.md's "Who shared it?" pill toggle (§4, panel #1d) — the
 * selected/deselected looks a participant row cycles through via
 * ParticipantPills. Same --button-bg{,-hover,-pressed}/--button-fg
 * mechanism as "dark" above (both build on "ghost", whose :hover/:active
 * rules read those variables rather than a plain background-color — see
 * button.css's `.button--ghost`), so hovering a pill in a desktop browser
 * doesn't flash to ghost's own default gray tint. "pillUnselected" reuses
 * ui/tabs.tsx's inactive-segment color rather than inventing a third one —
 * the mockup only ever shows every pill selected, so there's no ink-bg-
 * derived spec for "off" to match instead.
 */
const PILL_SELECTED_CLASS_NAME =
  "[--button-bg:var(--foreground)] [--button-bg-hover:var(--foreground)] [--button-bg-pressed:var(--foreground)] [--button-fg:var(--background)] rounded-full gap-[7px] px-[14px] min-h-[38px] text-[14px] font-bold";

const PILL_UNSELECTED_CLASS_NAME =
  "[--button-bg:rgba(43,33,24,.08)] [--button-bg-hover:rgba(43,33,24,.08)] [--button-bg-pressed:rgba(43,33,24,.08)] [--button-fg:rgba(43,33,24,.5)] rounded-full gap-[7px] px-[14px] min-h-[38px] text-[14px] font-bold";

/**
 * design-handoff.md's join-screen member row (§2, panel #1b): a white,
 * bordered tap target whose only hover/focus change is the border
 * brightening to accent — unlike "dashed"'s outline base, the mockup
 * specifies no gray hover fill, so this pins --button-bg-hover/-pressed to
 * the same surface color as the resting state instead of leaving outline's
 * default gray tint.
 */
const ROW_BUTTON_CLASS_NAME =
  "[--button-bg-hover:var(--surface)] [--button-bg-pressed:var(--surface)] w-full justify-start gap-[14px] rounded-card border-[1.5px] border-ink/[.18] bg-surface p-[18px] min-h-[64px] text-left hover:border-accent focus-visible:border-accent";

/**
 * design-handoff.md's Shares stepper (§4, panel #1f): a 38px square −/+
 * tap target. `p-0` cancels HeroUI's own px-4 the same way "dashed"'s
 * p-[13px] does, so the fixed h-/w- square isn't fought by default padding.
 */
const STEPPER_BUTTON_CLASS_NAME =
  "h-[38px] w-[38px] justify-center rounded-[10px] border-[1.5px] border-ink/20 bg-background p-0 font-mono text-[17px] font-bold text-ink disabled:opacity-40";

const EXTRA_CLASS_NAME: Partial<Record<ButtonVariant, string>> = {
  solid: PRESSED_BUTTON_CLASS_NAME,
  dashed: DASHED_BUTTON_CLASS_NAME,
  dark: DARK_PILL_CLASS_NAME,
  pillSelected: PILL_SELECTED_CLASS_NAME,
  pillUnselected: PILL_UNSELECTED_CLASS_NAME,
  row: ROW_BUTTON_CLASS_NAME,
  stepper: STEPPER_BUTTON_CLASS_NAME,
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
  "aria-pressed": ariaPressed,
  children,
}: {
  variant: ButtonVariant;
  type?: "button" | "submit";
  disabled?: boolean;
  fullWidth?: boolean;
  onClick?: () => void;
  "aria-label"?: string;
  // Toggle-button semantics (e.g. ParticipantPills' selected/deselected
  // state) — unset for every other call site, same opt-in-only shape as
  // aria-label above.
  "aria-pressed"?: boolean;
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
      aria-pressed={ariaPressed}
      className={EXTRA_CLASS_NAME[variant]}
    >
      {children}
    </HeroButton>
  );
}
