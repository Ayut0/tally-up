"use client";

import { ListBox, ListBoxItem, ListBoxItemIndicator, Select as HeroSelect } from "@heroui/react";
import type { ReactNode } from "react";
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
  labelVariant = "section-heading",
  value,
  onChange,
  options,
  renderTrigger,
  triggerClassName,
}: {
  label: string;
  // Same opt-in-per-screen idiom as TextField's own labelVariant: existing
  // call sites (record-payment, not yet skinned) keep rendering byte-for-byte
  // the same until a screen-skinning slice opts in.
  labelVariant?: "section-heading" | "label";
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  // Fully replaces the default `<Value/><Indicator/>` trigger content when
  // set — the add-expense screen's "Paid by" row needs an avatar + chevron
  // a plain text Value can't render; unset, the trigger is unchanged.
  renderTrigger?: () => ReactNode;
  triggerClassName?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <Text variant={labelVariant}>{label}</Text>
      <HeroSelect.Root selectedKey={value} onSelectionChange={(key) => onChange(String(key))}>
        <HeroSelect.Trigger className={triggerClassName}>
          {renderTrigger ? (
            renderTrigger()
          ) : (
            <>
              <HeroSelect.Value />
              <HeroSelect.Indicator />
            </>
          )}
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
