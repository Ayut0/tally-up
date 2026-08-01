import { describe, expect, it } from "vitest";
import { zBalanceSnapshot, zEntryRecord, zSplitRule } from "./api-schemas/zod.gen";

// api-schemas/zod.gen.ts is generated (`npm run gen:api-schemas`) from
// ../spec/openapi.yaml via web/openapi-ts.config.ts (ADR 0003, issue #116).
// These pin two properties that config's $resolvers.number override and the
// spec's discriminator-only-at-the-union-level modeling depend on, neither
// of which would fail `tsc --noEmit` if a regenerate silently dropped them
// (see openapi-ts.config.ts's own comment on why plain numbers matter here).

describe("generated zod schemas (spec/main.tsp -> spec/openapi.yaml)", () => {
  it("parses format: int64 fields as number, not bigint", () => {
    const parsed = zBalanceSnapshot.parse({
      balances: [{ member_id: "018f4c9e-0000-7000-8000-000000000001", balance: 4000 }],
      as_of_seq: 42,
    });
    expect(typeof parsed.as_of_seq).toBe("number");
    expect(typeof parsed.balances[0]!.balance).toBe("number");
    // A bigint here would throw on JSON.stringify (used by postIdempotent's
    // request bodies and any UI that echoes a parsed response back to fetch).
    expect(() => JSON.stringify(parsed)).not.toThrow();
  });

  it("discriminates SplitRule by `type` even though the OpenAPI variants (EqualSplit, ExactSplit, ...) don't declare it themselves", () => {
    const equal = zSplitRule.parse({ type: "equal" });
    const shares = zSplitRule.parse({
      type: "shares",
      weights: { "018f4c9e-0000-7000-8000-000000000001": 2 },
    });
    expect(equal).toEqual({ type: "equal" });
    expect(shares).toMatchObject({ type: "shares" });
  });

  it("rejects an entry whose id is not a well-formed UUID", () => {
    const result = zEntryRecord.safeParse({
      id: "not-a-uuid",
      seq: 1,
      kind: "expense",
      payer_id: "018f4c9e-0000-7000-8000-000000000001",
      total_amount: 4000,
      split_rule: { type: "equal" },
      participants: ["018f4c9e-0000-7000-8000-000000000001"],
      occurred_on: "2026-07-05",
      created_by: "018f4c9e-0000-7000-8000-000000000001",
      created_at: "2026-07-05T00:00:00Z",
      postings: [],
    });
    expect(result.success).toBe(false);
  });
});
