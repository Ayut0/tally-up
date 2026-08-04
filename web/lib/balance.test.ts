import { describe, expect, it } from "vitest";
import { buildBalanceRows } from "./balance";

describe("buildBalanceRows", () => {
  const members = [
    { id: "m1", name: "Alice" },
    { id: "m2", name: "Bob" },
    { id: "m3", name: "Carol" },
  ];

  it("returns one row per member, in member order", () => {
    const rows = buildBalanceRows(members, [
      { member_id: "m1", balance: 500 },
      { member_id: "m2", balance: -500 },
      { member_id: "m3", balance: 0 },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("formats a positive balance in green with a yen sign", () => {
    const [row] = buildBalanceRows(members, [{ member_id: "m1", balance: 1500 }]);
    expect(row.formattedAmount).toBe("¥1,500");
    expect(row.amountClassName).toBe("text-green-600 dark:text-green-400");
  });

  it("formats a negative balance in red", () => {
    const [row] = buildBalanceRows(members, [{ member_id: "m1", balance: -1500 }]);
    expect(row.formattedAmount).toBe("¥-1,500");
    expect(row.amountClassName).toBe("text-red-600 dark:text-red-400");
  });

  it("formats a zero balance as neutral", () => {
    const [row] = buildBalanceRows(members, [{ member_id: "m1", balance: 0 }]);
    expect(row.amountClassName).toBe("text-zinc-500");
  });

  it("defaults a member with no balance entry to zero, neutral", () => {
    const [row] = buildBalanceRows(members, []);
    expect(row.formattedAmount).toBe("¥0");
    expect(row.amountClassName).toBe("text-zinc-500");
  });
});
