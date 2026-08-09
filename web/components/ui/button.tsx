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
  children,
}: {
  variant: ButtonVariant;
  type?: "button" | "submit";
  disabled?: boolean;
  fullWidth?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <HeroButton
      variant={VARIANT_MAP[variant]}
      type={type}
      isDisabled={disabled}
      fullWidth={fullWidth}
      onPress={onClick}
    >
      {children}
    </HeroButton>
  );
}
