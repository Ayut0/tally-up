import { describe, expect, it } from "vitest";
import { pickPastel } from "./avatar";

describe("pickPastel", () => {
  it("is deterministic for a given member id", () => {
    const id = "018f4c9e-0000-7000-8000-000000000001";
    expect(pickPastel(id)).toEqual(pickPastel(id));
  });

  it("spreads across all 4 pastels for a small set of ids", () => {
    const ids = ["member-a", "member-b", "member-c", "member-d", "member-e", "member-f"];
    const buckets = new Set(ids.map((id) => pickPastel(id).bg));
    expect(buckets.size).toBeGreaterThan(1);
  });
});
