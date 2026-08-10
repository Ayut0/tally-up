type WordmarkSize = "sm" | "lg";

/**
 * The handoff's tally-mark glyph (4 bars + one diagonal strike) at the two
 * sizes the mockups actually use it: "lg" is the icon-and-text lockup on
 * Screen 01's header (`#1a`); "sm" is the icon alone, top-right on the
 * balances screen (`#1c`) — that usage never repeats the wordmark text, so
 * "sm" renders icon-only rather than a smaller icon+text lockup nobody
 * asked for.
 */
const GLYPH_SIZE: Record<
  WordmarkSize,
  { bar: string; strike: string; gap: string; height: string }
> = {
  lg: {
    bar: "w-[3px] h-5",
    strike: "left-[-3px] top-2 w-[22px] h-[3px]",
    gap: "gap-[2.5px] pr-[3px]",
    height: "h-5",
  },
  sm: {
    bar: "w-[2.5px] h-4",
    strike: "left-[-2px] top-[6.5px] w-[18px] h-[2.5px]",
    gap: "gap-[2px]",
    height: "h-4",
  },
};

function TallyGlyph({ size }: { size: WordmarkSize }) {
  const { bar, strike, gap, height } = GLYPH_SIZE[size];
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
  if (size === "sm") {
    return <TallyGlyph size="sm" />;
  }
  return (
    <div className="flex items-center gap-[10px]">
      <TallyGlyph size="lg" />
      {/* One-off lockup style, not a Text variant — text.tsx's variants are
          reusable roles (heading/label/body/...), and this wordmark
          typography only ever appears here. */}
      <span className="text-[26px] leading-none font-extrabold tracking-[-.02em] text-ink">
        tally-up
      </span>
    </div>
  );
}
