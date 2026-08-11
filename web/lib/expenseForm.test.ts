import { describe, expect, it } from "vitest";
import { canSubmitExpense, parseTotal, stripNonDigits } from "./expenseForm";

describe("parseTotal", () => {
  it("parses a positive whole-yen string as valid", () => {
    expect(parseTotal("12000")).toEqual({ total: 12000, valid: true });
  });

  it("rejects an empty string", () => {
    expect(parseTotal("").valid).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(parseTotal("   ").valid).toBe(false);
  });

  it("rejects a non-integer amount", () => {
    expect(parseTotal("12.5").valid).toBe(false);
  });

  it("rejects zero", () => {
    expect(parseTotal("0").valid).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(parseTotal("-100").valid).toBe(false);
  });
});

describe("canSubmitExpense", () => {
  const valid = { payerId: "member-1", participantCount: 2, totalValid: true, splitValid: true };

  it("allows submit when every input is valid", () => {
    expect(canSubmitExpense(valid)).toBe(true);
  });

  it("blocks submit with no payer selected", () => {
    expect(canSubmitExpense({ ...valid, payerId: "" })).toBe(false);
  });

  it("blocks submit with no participants", () => {
    expect(canSubmitExpense({ ...valid, participantCount: 0 })).toBe(false);
  });

  it("blocks submit with an invalid total", () => {
    expect(canSubmitExpense({ ...valid, totalValid: false })).toBe(false);
  });

  it("blocks submit with an invalid split", () => {
    expect(canSubmitExpense({ ...valid, splitValid: false })).toBe(false);
  });
});

describe("stripNonDigits", () => {
  it("leaves a plain digit string untouched", () => {
    expect(stripNonDigits("12000")).toBe("12000");
  });

  it("drops a decimal point and the digits after it stay", () => {
    expect(stripNonDigits("12.5")).toBe("125");
  });

  it("strips pasted currency formatting", () => {
    expect(stripNonDigits("¥1,000")).toBe("1000");
  });

  it("strips a leading minus sign", () => {
    expect(stripNonDigits("-100")).toBe("100");
  });

  it("returns an empty string unchanged", () => {
    expect(stripNonDigits("")).toBe("");
  });
});
