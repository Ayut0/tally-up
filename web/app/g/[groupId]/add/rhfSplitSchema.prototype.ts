import { z } from "zod";
import type { components } from "@/lib/api-types";
import { SplitMode } from "@/lib/split";

type SplitRule = components["schemas"]["SplitRule"];

// The inactive record for whichever mode isn't current accepts anything —
// it's never read, so `z.any()` keeps the schema's output type structurally
// equal to FormValues (both keys always present) without constraining a
// value this mode doesn't care about.
const anyRecord = z.record(z.string(), z.any());

const emptyShape = z.object({ amounts: anyRecord, weights: anyRecord });
const amountsShape = z.object({ amounts: z.record(z.string(), z.number()), weights: anyRecord });
const weightsShape = z.object({ amounts: anyRecord, weights: z.record(z.string(), z.number()) });

/**
 * PROTOTYPE for #141 — a zod schema mirroring web/lib/split.ts's
 * buildSplitRule, scoped to `mode`/`participantIds`/`total` the same way
 * useAddExpenseForm.ts closes over them, since none of those three live
 * inside the RHF form itself (mode is a separate useState; total lives in
 * the "easy fields" outside the split subtree; participantIds comes from
 * the participant checklist above).
 *
 * Deliberately reads only `participantIds` when checking completeness/sum —
 * the same trick `pick()` in lib/split.ts uses to make a de-selected
 * participant's leftover value in the record harmless, instead of reaching
 * for RHF's `shouldUnregister`/`unregister` (global side effects, per the
 * #139 research doc) to physically remove it.
 *
 * Each mode's schema declares ONLY the record it cares about (never both) —
 * discovered the hard way: a shared base shape requiring both `amounts` and
 * `weights` to be well-typed unconditionally means a stale NaN left behind
 * in the record for whichever mode isn't currently active (RHF keeps it
 * registered under the default shouldUnregister:false, per #139) fails
 * validation for *every* mode, not just its own — the base-shape failure is
 * a non-continuable `invalid_type` issue that suppresses superRefine
 * entirely (the same class of trap as #139 §2.4, just triggered by a mode
 * switch instead of an empty field). buildSplitRule's switch statement
 * sidesteps this for free by only ever reading the one record that
 * matches `mode`; matching that here needed a schema-per-mode instead of
 * one shared shape.
 */
export function buildRhfSplitSchema(
  mode: SplitRule["type"],
  participantIds: string[],
  total: number | undefined,
) {
  if (mode === SplitMode.Equal) return emptyShape;

  if (mode === SplitMode.Exact) {
    return amountsShape.superRefine((val, ctx) => {
      let sum = 0;
      for (const id of participantIds) {
        const v = val.amounts[id];
        if (v === undefined || Number.isNaN(v)) {
          ctx.addIssue({
            code: "custom",
            path: ["amounts", id],
            message: "fill in a value for every participant",
          });
          return;
        }
        if (v < 0 || !Number.isInteger(v)) {
          ctx.addIssue({
            code: "custom",
            path: ["amounts", id],
            message: "amounts must be whole yen, and none may be negative",
          });
          return;
        }
        sum += v;
      }
      if (total === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["amounts", participantIds[0] ?? ""],
          message: "total amount required",
        });
        return;
      }
      if (sum !== total) {
        ctx.addIssue({
          code: "custom",
          path: ["amounts", participantIds[participantIds.length - 1] ?? ""],
          message: `amounts sum to ¥${sum}, total is ¥${total}`,
        });
      }
    });
  }

  // Shares and Percent share the same weights shape; only the sum target differs.
  const requiredSum = mode === SplitMode.Percent ? 100 : undefined;
  const noun = mode === SplitMode.Percent ? "percentages" : "shares";

  return weightsShape.superRefine((val, ctx) => {
    let sum = 0;
    for (const id of participantIds) {
      const v = val.weights[id];
      if (v === undefined || Number.isNaN(v)) {
        ctx.addIssue({
          code: "custom",
          path: ["weights", id],
          message: "fill in a value for every participant",
        });
        return;
      }
      if (v <= 0 || !Number.isInteger(v)) {
        ctx.addIssue({
          code: "custom",
          path: ["weights", id],
          message: `${noun} must be positive whole numbers`,
        });
        return;
      }
      sum += v;
    }
    if (requiredSum !== undefined && sum !== requiredSum) {
      ctx.addIssue({
        code: "custom",
        path: ["weights", participantIds[participantIds.length - 1] ?? ""],
        message: `percentages sum to ${sum}, must be 100`,
      });
    }
  });
}
