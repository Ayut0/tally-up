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
        //
        // Supplying $resolvers.number at all fully replaces the plugin's
        // default resolver (zod/v4/toAst/number.ts's numberResolver), not
        // just the bigint step — so this also has to reproduce the
        // minimum/maximum → .gte()/.lte() composition that resolver does,
        // or every bound declared in spec/main.tsp (e.g. SharesWeight's
        // @minValue/@maxValue) would silently vanish from the generated
        // schema (see issue #252). Deliberately not reproduced: the
        // library's format-based fallback range for bound-less int64/uint64
        // fields (getIntegerLimit) always routes the literal through
        // maybeBigInt, which wraps it in BigInt(...) whenever
        // format === "int64" — regardless of the bigint override above —
        // which would attach a BigInt(...) literal onto our plain
        // z.number() chain. Only explicit minimum/maximum from the schema
        // are honored; a field with neither gets no bound, same as before
        // this override existed.
        number(ctx) {
          const { $, schema, plugin } = ctx;
          const { z } = plugin.imports;
          let chain = $(z).attr("number").call();
          if (schema.type === "integer") chain = chain.attr("int").call();
          if (schema.exclusiveMinimum !== undefined) {
            chain = chain.attr("gt").call($.fromValue(schema.exclusiveMinimum));
          } else if (schema.minimum !== undefined) {
            chain = chain.attr("gte").call($.fromValue(schema.minimum));
          }
          if (schema.exclusiveMaximum !== undefined) {
            chain = chain.attr("lt").call($.fromValue(schema.exclusiveMaximum));
          } else if (schema.maximum !== undefined) {
            chain = chain.attr("lte").call($.fromValue(schema.maximum));
          }
          return chain;
        },
      },
    },
  ],
});
