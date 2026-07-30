import { defineConfig } from "@hey-api/openapi-ts";

// Generates web/lib/api-schemas/ from ../spec/openapi.yaml (ADR 0003) —
// zod counterpart to `gen:api-types`'s openapi-typescript output. Only the
// zod plugin runs (no client/SDK): this codebase has its own fetch wrapper
// (lib/api.ts) with a bespoke idempotent-retry contract, not something a
// generated HTTP client should own.
export default defineConfig({
  input: "../spec/openapi.yaml",
  output: "lib/api-schemas",
  plugins: [
    {
      name: "zod",
      // One named schema per component (GroupRecord, SplitRule, ...),
      // not per-operation request/response unions — this app only needs
      // the former to validate `fetch` responses.
      definitions: true,
      requests: false,
      responses: false,
      $resolvers: {
        // Every `format: int64` field in this spec (total_amount, seq,
        // balance, ...) is a minor-currency-unit amount capped well under
        // Number.MAX_SAFE_INTEGER (see CreateEntryRequest's total_amount
        // description in spec/main.tsp). The zod plugin's default for
        // int64/uint64 is `z.coerce.bigint()`, which would make every
        // amount a `bigint` — incompatible with api-types.ts's `number`
        // types and with plain arithmetic/JSON.stringify elsewhere in
        // web/. Override to plain z.number()/z.number().int() regardless
        // of format.
        number(ctx) {
          const { $, schema, plugin } = ctx;
          const { z } = plugin.imports;
          let chain = $(z).attr("number").call();
          if (schema.type === "integer") chain = chain.attr("int").call();
          return chain;
        },
      },
    },
  ],
});
