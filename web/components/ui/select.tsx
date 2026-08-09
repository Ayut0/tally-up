"use client";

import { ListBox, ListBoxItem, ListBoxItemIndicator, Select as HeroSelect } from "@heroui/react";
import { Text } from "./text";

type SelectOption = { id: string; label: string };

/**
 * Curated, not pass-through: unlike a native `<select>`, HeroUI's Select
 * is a react-aria-components collection widget (Root/Trigger/Value/
 * Indicator/Popover + a ListBox of ListBoxItems), controlled via
 * `selectedKey`/`onSelectionChange` rather than a DOM onChange event — so
 * it can't take react-hook-form's `register()` spread. Callers bind it
 * the same way they already bind non-native controls in this app (plain
 * value/onChange), same pattern as `mode`/`setMode` in
 * useAddExpenseForm.ts.
 */
export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <Text variant="section-heading">{label}</Text>
      <HeroSelect.Root selectedKey={value} onSelectionChange={(key) => onChange(String(key))}>
        <HeroSelect.Trigger>
          <HeroSelect.Value />
          <HeroSelect.Indicator />
        </HeroSelect.Trigger>
        <HeroSelect.Popover>
          <ListBox>
            {options.map((option) => (
              <ListBoxItem key={option.id} id={option.id} textValue={option.label}>
                {option.label}
                <ListBoxItemIndicator />
              </ListBoxItem>
            ))}
          </ListBox>
        </HeroSelect.Popover>
      </HeroSelect.Root>
    </label>
  );
}
