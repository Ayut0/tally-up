"use client";

import { Input } from "@heroui/react";
import type { InputHTMLAttributes, Ref } from "react";
import { Text } from "./text";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  label: string;
  error?: string | null;
  ref?: Ref<HTMLInputElement>;
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
export function TextField({ label, error, ref, ...inputProps }: TextFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <Text variant="section-heading">{label}</Text>
      <Input ref={ref} aria-invalid={!!error} {...inputProps} />
      {error && <Text variant="error">{error}</Text>}
    </label>
  );
}
