"use client";

import { Tabs as HeroTabs } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * Curated wrapper over HeroUI's compound Tabs (Root/List/Tab/Panel):
 * only the currently-selected Tab gets an `aria-controls` (react-aria
 * leaves it `undefined` on the rest — see
 * react-aria/dist/private/tabs/useTab.mjs), so rendering exactly one
 * Panel matching `value` keeps every aria-controls reference valid
 * without needing one Panel per tab.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  children,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  return (
    <HeroTabs.Root selectedKey={value} onSelectionChange={(key) => onChange(key as T)}>
      <HeroTabs.List>
        {tabs.map((tab) => (
          <HeroTabs.Tab key={tab.id} id={tab.id}>
            {tab.label}
          </HeroTabs.Tab>
        ))}
      </HeroTabs.List>
      <HeroTabs.Panel id={value}>{children}</HeroTabs.Panel>
    </HeroTabs.Root>
  );
}
