import { z } from "zod";

// Runtime mirrors of the response shapes in ./api-types (generated from
// spec/openapi.yaml, ADR 0003). api-types.ts is compile-time only, so
// parsing a fetch response against it needs a schema that validates at
// runtime; these are hand-kept in sync with the generated types since
// openapi-typescript does not emit zod schemas itself.

const uuid = z.string();
const calendarDate = z.string();

const member = z.object({ id: uuid, name: z.string() });

export const groupRecordSchema = z.object({
  id: uuid,
  name: z.string(),
  members: z.array(member),
});

const memberBalance = z.object({ member_id: uuid, balance: z.number() });

export const balanceSnapshotSchema = z.object({
  balances: z.array(memberBalance),
  as_of_seq: z.number(),
});

const posting = z.object({ member_id: uuid, amount: z.number() });

const splitRule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("equal") }),
  z.object({ type: z.literal("exact"), amounts: z.record(z.string(), z.number()) }),
  z.object({ type: z.literal("shares"), weights: z.record(z.string(), z.number()) }),
  z.object({ type: z.literal("percent"), weights: z.record(z.string(), z.number()) }),
]);

const entryRecord = z.object({
  id: uuid,
  seq: z.number(),
  kind: z.enum(["expense", "settlement", "reversal"]),
  reverses_id: uuid.optional(),
  payer_id: uuid,
  counterparty: uuid.optional(),
  total_amount: z.number(),
  split_rule: splitRule,
  participants: z.array(uuid),
  memo: z.string().optional(),
  occurred_on: calendarDate,
  created_by: uuid,
  created_at: z.string(),
  postings: z.array(posting),
});

export const entryListSchema = z.object({ entries: z.array(entryRecord) });

export const entryAckSchema = z.object({ id: uuid, seq: z.number() });

export const errorBodySchema = z.object({ error: z.string() });
