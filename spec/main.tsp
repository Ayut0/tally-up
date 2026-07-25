import "@typespec/http";

using Http;

/**
 * tab — n-person bill splitter.
 *
 * This spec is the source of truth for the HTTP contract. The Go server
 * validates its responses against the emitted `openapi.yaml`; the web client
 * generates its types from it. Change the contract here first, then both sides.
 */
@service(#{ title: "tab API" })
@server("http://localhost:8080", "Local development")
namespace TabApi;

/** RFC 9562 UUID. This codebase mints v7 everywhere, so ids are time-ordered. */
@format("uuid")
scalar Uuid extends string;

/** Calendar date in `YYYY-MM-DD`. */
scalar CalendarDate extends plainDate;

/** How an entry's total is divided among its participants. */
@discriminated(#{ envelope: "none", discriminatorPropertyName: "type" })
union SplitRule {
  equal: EqualSplit,
  exact: ExactSplit,
  shares: SharesSplit,
  percent: PercentSplit,
}

/** Every participant owes the same share; the remainder is distributed deterministically. */
model EqualSplit {}

/** Exact minor-unit amount per member. Keys MUST be exactly the participant set. */
model ExactSplit {
  amounts: Record<int64>;
}

/** Relative weights per member. Keys MUST be exactly the participant set. */
model SharesSplit {
  weights: Record<int64>;
}

/** Percentage weights per member. Keys MUST be exactly the participant set. */
model PercentSplit {
  weights: Record<int64>;
}

/** What kind of movement an entry records. */
union EntryKind {
  expense: "expense",
  settlement: "settlement",
  reversal: "reversal",
}

/** One member's signed net amount for an entry. Postings for an entry sum to zero. */
model Posting {
  member_id: Uuid;
  amount: int64;
}

/** An entry as persisted and returned by the server. */
model EntryRecord {
  id: Uuid;

  /** Monotonic per-group sequence; the cursor for `after_seq` polling. */
  seq: int64;

  kind: EntryKind;
  reverses_id?: Uuid;
  payer_id: Uuid;
  counterparty?: Uuid;
  total_amount: int64;
  split_rule: SplitRule;
  participants: Uuid[];
  memo?: string;
  occurred_on: CalendarDate;
  created_by: Uuid;
  created_at: utcDateTime;
  postings: Posting[];
}

model CreateEntryRequest {
  /** Client-generated UUIDv7. Required — the server does not mint entry ids. */
  id: Uuid;

  kind: EntryKind;
  payer_id: Uuid;

  /** Required for settlements; the member being paid. */
  counterparty?: Uuid;

  /** Minor currency units. Must be in `(0, 100_000_000_000]`. */
  total_amount: int64;

  split_rule: SplitRule;
  participants: Uuid[];
  memo?: string;
  occurred_on: CalendarDate;
}

@error
model ApiError {
  @statusCode statusCode: 400 | 409 | 422 | 500;
  error: string;
}

/** The entry was accepted and written. */
model EntryCreated {
  @statusCode statusCode: 201;
  @body entry: EntryRecord;
}

/**
 * Replay: this `Idempotency-Key` already succeeded, and the body is the
 * snapshot from that original write. Not an error — treat as success.
 */
model EntryReplayed {
  @statusCode statusCode: 200;
  @body entry: EntryRecord;
}

/**
 * Record an expense or settlement.
 *
 * `Idempotency-Key` is one key per user intent, reused verbatim across retries.
 * A retry that lands after the original succeeded returns 200 with the original
 * body; reusing a key with a different payload is 422; a concurrent in-flight
 * request with the same key is 409 and should be retried shortly.
 */
@route("/groups/{group_id}/entries")
@post
op createEntry(
  @path group_id: Uuid,
  @header("Idempotency-Key") idempotencyKey: Uuid,
  @body entry: CreateEntryRequest,
): EntryCreated | EntryReplayed | ApiError;
