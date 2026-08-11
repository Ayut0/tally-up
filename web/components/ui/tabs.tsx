"use client";

import { Tabs as HeroTabs, cn } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * Narrows HeroUI's `onSelectionChange` key (`string | number`, from
 * react-aria's `Key`) down to this instance's own tab ids, without
 * asserting it — `key` only ever originates from the `id`s this
 * component itself handed to `HeroTabs.Tab` below, so the check always
 * succeeds in practice; the guard makes that provable to the type
 * checker instead of assumed.
 */
function isTabId<T extends string>(key: unknown, tabs: { id: T }[]): key is T {
  return typeof key === "string" && tabs.some((tab) => tab.id === key);
}

/**
 * Curated wrapper over HeroUI's compound Tabs (Root/List/Tab/Panel):
 * only the currently-selected Tab gets an `aria-controls` (react-aria
 * leaves it `undefined` on the rest — see
 * react-aria/dist/private/tabs/useTab.mjs), so rendering exactly one
 * Panel matching `value` keeps every aria-controls reference valid
 * without needing one Panel per tab.
 *
 * Sole consumer today is SplitModeSection's 4-way Equal/Exact/Shares/Percent
 * control (design-handoff.md §4's segmented-control spec), so this reskins
 * unconditionally rather than gating behind an opt-in prop the way
 * TextField/Select do for components with an unskinned caller still in use.
 * Each Tab's own conditional bg (not a sliding TabIndicator) matches the
 * mockup's static per-cell look and sidesteps HeroUI's --segment/
 * --segment-foreground theme vars, which this app's tokens never override.
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
    <HeroTabs.Root
      selectedKey={value}
      onSelectionChange={(key) => {
        if (isTabId(key, tabs)) onChange(key);
      }}
    >
      {/* HeroUI's base .tabs__list also carries w-max (data-orientation=
          "horizontal") from tabs.css, which fights a 4-column grid's fr
          tracks — w-full pins the track to the field's full width, matching
          the mockup. */}
      <HeroTabs.List className="grid w-full grid-cols-4 gap-1 rounded-field bg-ink/[.08] p-1">
        {tabs.map((tab) => (
          <HeroTabs.Tab
            key={tab.id}
            id={tab.id}
            // HeroUI's own Tab wrapper narrows `className` to `string` (its
            // .d.ts drops the function-render-prop form the underlying RAC
            // Tab primitive accepts), so selection state is read off `value`
            // directly instead of an `isSelected` render prop.
            className={cn(
              "rounded-segment px-0 py-[9px] text-center font-sans text-[13px]",
              tab.id === value
                ? "bg-white font-extrabold text-ink shadow-[0_1px_3px_rgba(43,33,24,.12)]"
                : "font-bold text-ink/50",
            )}
          >
            {tab.label}
          </HeroTabs.Tab>
        ))}
      </HeroTabs.List>
      {/* HeroUI's default panel adds p-2 + mt-4 (data-orientation="horizontal")
          from tabs.css — overridden to mt-2/p-0 so the List→Panel gap matches
          the mockup's single 8px rhythm running label→track→preview, same as
          every other field on this screen. */}
      <HeroTabs.Panel id={value} className="mt-2 p-0">
        {children}
      </HeroTabs.Panel>
    </HeroTabs.Root>
  );
}
