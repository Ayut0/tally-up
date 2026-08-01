import { describe, expect, it } from "vitest";
import { buildSplitRule, previewShares, SplitMode } from "./split";

// Member ids chosen so lexicographic order is a < b < c (mirrors UUID byte order).
const A = "00000000-0000-0000-0000-00000000000b";
const B = "00000000-0000-0000-0000-00000000000c";
const C = "00000000-0000-0000-0000-00000000000d";

describe("previewShares — must mirror the Go largest-remainder engine", () => {
  it("equal 12000 / 3", () => {
    expect(previewShares(12000, { type: "equal" }, [A, B, C])).toEqual({
      [A]: 4000,
      [B]: 4000,
      [C]: 4000,
    });
  });

  it("equal 10000 / 3: remainder tie goes to smallest id (Go test parity)", () => {
    expect(previewShares(10000, { type: "equal" }, [A, B, C])).toEqual({
      [A]: 3334,
      [B]: 3333,
      [C]: 3333,
    });
  });

  it("shares 1:2 of 100: extra yen to the larger remainder (Go test parity)", () => {
    expect(previewShares(100, { type: "shares", weights: { [A]: 1, [B]: 2 } }, [A, B])).toEqual({
      [A]: 33,
      [B]: 67,
    });
  });

  it("percent 50/30/20 of 10000", () => {
    expect(
      previewShares(10000, { type: "percent", weights: { [A]: 50, [B]: 30, [C]: 20 } }, [A, B, C]),
    ).toEqual({ [A]: 5000, [B]: 3000, [C]: 2000 });
  });

  it("exact passes through", () => {
    expect(
      previewShares(12000, { type: "exact", amounts: { [A]: 7000, [B]: 5000 } }, [A, B]),
    ).toEqual({ [A]: 7000, [B]: 5000 });
  });
});

describe("buildSplitRule validation", () => {
  it("valid inputs return the rule object", () => {
    expect(buildSplitRule(SplitMode.Equal, [A, B], {})).toEqual({ type: "equal" });
  });

  it("exact must sum to total", () => {
    const r = buildSplitRule(SplitMode.Exact, [A, B], {
      total: 12000,
      amounts: { [A]: 7000, [B]: 4999 },
    });
    expect(typeof r).toBe("string"); // error message
  });

  it("percent must sum to 100", () => {
    const r = buildSplitRule(SplitMode.Percent, [A, B], { weights: { [A]: 60, [B]: 39 } });
    expect(typeof r).toBe("string");
  });

  it("shares must be positive", () => {
    const r = buildSplitRule(SplitMode.Shares, [A, B], { weights: { [A]: 0, [B]: 2 } });
    expect(typeof r).toBe("string");
  });

  it("exact rejects a negative amount even if the sum happens to match total", () => {
    const r = buildSplitRule(SplitMode.Exact, [A, B], {
      total: 12000,
      amounts: { [A]: -1000, [B]: 13000 },
    });
    expect(typeof r).toBe("string");
  });

  it("exact with no total set reports a clear error, not literal 'undefined'", () => {
    const r = buildSplitRule(SplitMode.Exact, [A, B], { amounts: { [A]: 7000, [B]: 5000 } });
    expect(r).not.toMatch(/undefined/);
  });
});
