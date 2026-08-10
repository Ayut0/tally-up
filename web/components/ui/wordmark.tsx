import { Text } from "./text";

type WordmarkSize = "sm" | "lg";

/**
 * The handoff's tally-mark glyph (4 bars + one diagonal strike) at the two
 * sizes the mockups actually use it: "lg" is the icon-and-text lockup on
 * Screen 01's header (`#1a`); "sm" is the icon alone, top-right on the
 * balances screen (`#1c`) — that usage never repeats the wordmark text.
 * `showText` lives in this same size-keyed config (rather than a
 * `size === "sm"` string comparison at the call site) so the "does this
 * size render text" decision has one source, driven by the type.
 */
const WORDMARK: Record<
  WordmarkSize,
  { bar: string; strike: string; gap: string; height: string; showText: boolean }
> = {
  lg: {
    bar: "w-[3px] h-5",
    strike: "left-[-3px] top-2 w-[22px] h-[3px]",
    gap: "gap-[2.5px] pr-[3px]",
    height: "h-5",
    showText: true,
  },
  sm: {
    bar: "w-[2.5px] h-4",
    strike: "left-[-2px] top-[6.5px] w-[18px] h-[2.5px]",
    gap: "gap-[2px]",
    height: "h-4",
    showText: false,
  },
};

function TallyGlyph({ size }: { size: WordmarkSize }) {
  const { bar, strike, gap, height } = WORDMARK[size];
  return (
    <div className={`relative flex items-end ${gap} ${height}`}>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={`rounded-[2px] bg-accent ${bar}`} />
      ))}
      <div className={`absolute rounded-[2px] bg-ink ${strike} rotate-[-24deg]`} />
    </div>
  );
}

export function Wordmark({ size = "lg" }: { size?: WordmarkSize }) {
  if (!WORDMARK[size].showText) {
    return <TallyGlyph size={size} />;
  }
  return (
    <div className="flex items-center gap-[10px]">
      <TallyGlyph size={size} />
      <Text variant="wordmark">tally-up</Text>
    </div>
  );
}
