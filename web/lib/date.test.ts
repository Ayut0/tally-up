import { describe, expect, it } from "vitest";
import { todayLocal } from "./date";

describe("todayLocal", () => {
  // Both ends of the same local day. `new Date().toISOString().slice(0, 10)`
  // — the expression this exists to replace — disagrees with one of these in
  // every timezone but UTC, which is the whole point: a settlement recorded
  // at 06:40 in Tokyo happened today, not yesterday.
  it("returns the date the local clock shows, at both ends of the day", () => {
    expect(todayLocal(new Date(2026, 7, 3, 0, 30))).toBe("2026-08-03");
    expect(todayLocal(new Date(2026, 7, 3, 23, 30))).toBe("2026-08-03");
  });

  it("zero-pads month and day to the CalendarDate format", () => {
    expect(todayLocal(new Date(2026, 0, 5, 12, 0))).toBe("2026-01-05");
  });
});
