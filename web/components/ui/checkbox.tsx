"use client";

import { Checkbox as HeroCheckbox } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * Curated, not pass-through: HeroUI's Checkbox is a react-aria-components
 * CheckboxField/CheckboxButton compound, controlled via
 * `isSelected`/`onChange(isSelected: boolean)` rather than a native
 * checkbox onChange event — same non-native-input situation as `Select`.
 * `Checkbox.Content` already renders as its own label wrapping the
 * control, so (unlike `TextField`/`Select`) no extra `<label>` here.
 */
export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <HeroCheckbox.Root isSelected={checked} onChange={onChange}>
      <HeroCheckbox.Content>
        <HeroCheckbox.Control>
          <HeroCheckbox.Indicator />
        </HeroCheckbox.Control>
        {children}
      </HeroCheckbox.Content>
    </HeroCheckbox.Root>
  );
}
