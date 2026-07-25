import { describe, expect, it } from "vitest";
import type { components, paths } from "./api-types";

// api-types.ts is generated (`npm run gen:api-types`) from ../spec/openapi.yaml
// and carries no runtime code of its own — it's pure type declarations. That
// means a contract change here can only be caught at compile time, not by
// vitest's own transform (esbuild strips types without checking them). `npm
// test` runs `tsc --noEmit` first specifically so this file's `satisfies`
// assignments fail the build the moment the generated types drift from what
// the rest of this suite assumes, before any test even executes.

describe("generated API types (spec/main.tsp -> spec/openapi.yaml)", () => {
  it("exposes the four route templates the spec declares", () => {
    // The 5 operations share 4 path templates: POST and GET both live under
    // /groups/{group_id}/entries.
    const routes: (keyof paths)[] = [
      "/groups/{group_id}/entries",
      "/groups/{group_id}/entries/{entry_id}",
      "/groups/{group_id}/entries/{entry_id}/reverse",
      "/groups/{group_id}/balance",
    ];
    expect(routes).toHaveLength(4);
  });

  it("models SplitRule as a kind-discriminated union, not a flat struct", () => {
    const equal: components["schemas"]["SplitRule"] = { type: "equal" };
    const shares: components["schemas"]["SplitRule"] = {
      type: "shares",
      weights: { "11111111-1111-1111-1111-111111111111": 2 },
    };
    // A SharesSplit missing `weights`, or carrying `amounts` instead, is a
    // compile error here — that's the property this test exists to pin.
    expect(equal.type).toBe("equal");
    expect(shares.type).toBe("shares");
  });

  it("models CreateEntryRequest as a kind-discriminated union: settlements carry no split_rule", () => {
    const settlement: components["schemas"]["CreateEntryRequest"] = {
      kind: "settlement",
      id: "11111111-1111-1111-1111-111111111111",
      payer_id: "22222222-2222-2222-2222-222222222222",
      counterparty: "33333333-3333-3333-3333-333333333333",
      total_amount: 4000,
      occurred_on: "2026-07-05",
    };
    expect(settlement.kind).toBe("settlement");
  });

  it("keeps a reversal's reverses_id distinct from an edit's reversal_entry_id", () => {
    const reversalAck: components["schemas"]["ReversalAck"] = {
      id: "11111111-1111-1111-1111-111111111111",
      seq: 1,
      reverses_id: "22222222-2222-2222-2222-222222222222",
    };
    const editAck: components["schemas"]["EditAck"] = {
      id: "33333333-3333-3333-3333-333333333333",
      seq: 2,
      reversal_entry_id: "44444444-4444-4444-4444-444444444444",
    };
    // These field names are one character apart and mean opposite things
    // (interfaces/rest/reversals.go) — pinning them here is what makes a
    // regenerated api-types.ts that merges them back together fail to compile.
    expect(reversalAck).not.toHaveProperty("reversal_entry_id");
    expect(editAck).not.toHaveProperty("reverses_id");
  });
});
