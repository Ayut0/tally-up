"use client";

import { Input, cn } from "@heroui/react";
import type { InputHTMLAttributes, Ref } from "react";
import { Text } from "./text";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  label: string;
  error?: string | null;
  ref?: Ref<HTMLInputElement>;
  // Both optional and defaulted to today's look, so existing call sites
  // (add-expense, member-list, record-payment — not yet skinned) render
  // byte-for-byte the same. A skinned screen opts in per field rather than
  // this component reskinning every TextField at once (design-handoff.md's
  // screen-skinning slices land one screen at a time).
  labelVariant?: "section-heading" | "label";
  inputClassName?: string;
};

/**
 * Wraps HeroUI's bare `Input` (a real native `<input>` under
 * react-aria-components, not HeroUI's own `TextField`/RAC's `TextField`)
 * rather than a field-context component: RAC's `TextField` owns
 * value/onChange itself and hands back a string from onChange, which
 * breaks react-hook-form's `register()` spread (`{name, onChange, onBlur,
 * ref}`, event-based). Staying on the bare `Input` keeps both the
 * register() case and plain controlled value/onChange working the same
 * way a native `<input>` always has.
 */
export function TextField({
  label,
  error,
  ref,
  labelVariant = "section-heading",
  inputClassName,
  ...inputProps
}: TextFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <Text variant={labelVariant}>{label}</Text>
      {/* aria-invalid:border-negative (issue #143) — the only way any field
          gets a visual invalid state today; aria-invalid alone is set but
          unstyled otherwise. Merged via cn, not concatenated, so it wins
          over inputClassName's own resting-state border-color only when
          aria-invalid is true. */}
      <Input
        ref={ref}
        aria-invalid={!!error}
        className={cn("aria-invalid:border-negative", inputClassName)}
        {...inputProps}
      />
      {error && <Text variant="error">{error}</Text>}
    </label>
  );
}
