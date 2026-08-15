import { describe, expect, it } from "vitest";
import { formatYen } from "./currency";

describe("formatYen", () => {
  it("formats a whole yen amount with thousands separators", () => {
    expect(formatYen(8000)).toBe("¥8,000");
  });

  it("formats zero", () => {
    expect(formatYen(0)).toBe("¥0");
  });
});
