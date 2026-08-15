import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { UseFormRegisterReturn } from "react-hook-form";
import { SplitModeSection } from "./splitModeSection";

const MEMBERS = [
  { id: "m1", name: "Yuto" },
  { id: "m2", name: "Aya" },
  { id: "m3", name: "Kenji" },
  { id: "m4", name: "Mio" },
];

const SPLIT_TABS = (
  active: "equal" | "exact" | "shares" | "percent",
): { mode: "equal" | "exact" | "shares" | "percent"; label: string; active: boolean }[] =>
  (["equal", "exact", "shares", "percent"] as const).map((mode) => ({
    mode,
    label: mode === "equal" ? "Equal" : mode[0]!.toUpperCase() + mode.slice(1),
    active: mode === active,
  }));

/**
 * Fakes react-hook-form's `register()` for the story: no real form backs
 * these panels, so this just seeds each input's initial DOM value via
 * `defaultValue` (register()-bound inputs are uncontrolled) and no-ops the
 * rest.
 */
function fakeRegister(values: Record<string, number>) {
  return (memberId: string): UseFormRegisterReturn =>
    ({
      name: memberId,
      onChange: async () => {},
      onBlur: async () => {},
      ref: () => {},
      defaultValue: values[memberId],
    }) as UseFormRegisterReturn;
}

const meta = {
  title: "AddExpense/SplitModeSection",
  component: SplitModeSection,
  args: {
    setMode: () => {},
    registerAmount: fakeRegister({}),
    incrementWeight: () => {},
    decrementWeight: () => {},
    registerPercent: fakeRegister({}),
    ruleError: null,
    previewRows: null,
  },
} satisfies Meta<typeof SplitModeSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExactComplete: Story = {
  args: {
    mode: "exact",
    splitTabs: SPLIT_TABS("exact"),
    showExactInputs: true,
    exactRows: [
      { id: "m1", name: "Yuto", amount: 3000 },
      { id: "m2", name: "Aya", amount: 2000 },
      { id: "m3", name: "Kenji", amount: 2000 },
      { id: "m4", name: "Mio", amount: 1000 },
    ],
    exactSummary: { enteredFormatted: "¥8,000", targetFormatted: "¥8,000", matches: true },
    registerAmount: fakeRegister({ m1: 3000, m2: 2000, m3: 2000, m4: 1000 }),
    showSharesInputs: false,
    sharesRows: [],
    sharesSummary: null,
    showPercentInputs: false,
    percentRows: [],
    percentSummary: null,
  },
};

export const ExactInProgress: Story = {
  args: {
    ...ExactComplete.args,
    exactRows: [
      { id: "m1", name: "Yuto", amount: 3000 },
      { id: "m2", name: "Aya", amount: 2000 },
      { id: "m3", name: "Kenji", amount: "" },
      { id: "m4", name: "Mio", amount: "" },
    ],
    exactSummary: { enteredFormatted: "¥5,000", targetFormatted: "¥8,000", matches: false },
    registerAmount: fakeRegister({ m1: 3000, m2: 2000 }),
  },
};

export const SharesComplete: Story = {
  args: {
    mode: "shares",
    splitTabs: SPLIT_TABS("shares"),
    showExactInputs: false,
    exactRows: [],
    exactSummary: null,
    showSharesInputs: true,
    sharesRows: [
      { id: "m1", name: "Yuto", weight: 2, formattedShare: "¥3,200" },
      { id: "m2", name: "Aya", weight: 1, formattedShare: "¥1,600" },
      { id: "m3", name: "Kenji", weight: 1, formattedShare: "¥1,600" },
      { id: "m4", name: "Mio", weight: 1, formattedShare: "¥1,600" },
    ],
    sharesSummary: { count: 5, totalFormatted: "¥8,000" },
    showPercentInputs: false,
    percentRows: [],
    percentSummary: null,
  },
};

export const PercentWithDeselectedMember: Story = {
  args: {
    mode: "percent",
    splitTabs: SPLIT_TABS("percent"),
    showExactInputs: false,
    exactRows: [],
    exactSummary: null,
    showSharesInputs: false,
    sharesRows: [],
    sharesSummary: null,
    showPercentInputs: true,
    percentRows: [
      { id: "m1", name: "Yuto", active: true, percent: 34, formattedShare: "¥2,720" },
      { id: "m2", name: "Aya", active: true, percent: 33, formattedShare: "¥2,640" },
      { id: "m3", name: "Kenji", active: true, percent: 33, formattedShare: "¥2,640" },
      { id: "m4", name: "Mio", active: false },
    ],
    percentSummary: { percentTotal: 100, totalFormatted: "¥8,000", complete: true },
    registerPercent: fakeRegister({ m1: 34, m2: 33, m3: 33 }),
  },
};

export const EqualPreview: Story = {
  args: {
    mode: "equal",
    splitTabs: SPLIT_TABS("equal"),
    showExactInputs: false,
    exactRows: [],
    exactSummary: null,
    showSharesInputs: false,
    sharesRows: [],
    sharesSummary: null,
    showPercentInputs: false,
    percentRows: [],
    percentSummary: null,
    previewRows: MEMBERS.map((m) => ({ id: m.id, name: m.name, formattedShare: "¥2,000" })),
  },
};
