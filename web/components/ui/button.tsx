"use client";

import { Button as HeroButton } from "@heroui/react";
import type { ReactNode } from "react";

type ButtonVariant = "solid" | "danger" | "ghost";

const VARIANT_MAP: Record<ButtonVariant, "primary" | "danger" | "ghost"> = {
  solid: "primary",
  danger: "danger",
  ghost: "ghost",
};

/**
 * design-handoff.md's "pressed button" treatment for the "solid"/primary
 * variant only — danger/ghost aren't specced by the handoff and stay on
 * HeroUI's defaults. HeroUI's Button merges this className with its own
 * variant classes via tailwind-merge (see composeTwRenderProps), so later,
 * more specific utilities here win over the base rounded-3xl/px-4 HeroUI
 * ships.
 */
const PRESSED_BUTTON_CLASS_NAME =
  "rounded-button p-[17px] min-h-[52px] text-[17px] font-extrabold shadow-pressed";

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
      className={variant === "solid" ? PRESSED_BUTTON_CLASS_NAME : undefined}
    >
      {children}
    </HeroButton>
  );
}
