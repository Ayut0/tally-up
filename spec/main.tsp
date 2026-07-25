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

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** RFC 9562 UUID. This codebase mints v7 everywhere, so ids are time-ordered. */
@format("uuid")
scalar Uuid extends string;

/** Calendar date in `YYYY-MM-DD`. */
scalar CalendarDate extends plainDate;

// ---------------------------------------------------------------------------
// Split rules
// ---------------------------------------------------------------------------

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

/** Exact minor-unit amount per member, keyed by member id. */
model ExactSplit {
  amounts: Record<int64>;
}

/** Relative weights per member, keyed by member id. */
model SharesSplit {
  weights: Record<int64>;
}

/** Percentage weights per member, keyed by member id. */
model PercentSplit {
  weights: Record<int64>;
}

// ---------------------------------------------------------------------------
// Ledger models
// ---------------------------------------------------------------------------

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

  /** Set on a reversal entry: the entry it reverses. */
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

/** One member's net position: positive = is owed, negative = owes. */
model MemberBalance {
  member_id: Uuid;
  balance: int64;
}

/**
 * Every group member's balance plus the max entry seq those balances reflect.
 * Both are read in one SQL statement (one MVCC snapshot), so `as_of_seq` is
 * exactly the ledger state the balances derive from.
 */
model BalanceSnapshot {
  balances: MemberBalance[];
  as_of_seq: int64;
}

model EntryList {
  entries: EntryRecord[];
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

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

  /** Must be non-empty and free of duplicates. */
  participants: Uuid[];

  memo?: string;
  occurred_on: CalendarDate;
}

/**
 * Editing is a correction, not a mutation: the original is reversed and a
 * replacement is appended, so the ledger stays append-only.
 */
model EditEntryRequest {
  ...CreateEntryRequest;

  /** Client-generated UUIDv7 for the reversal entry that retires the original. */
  reversal_id: Uuid;
}

model ReverseEntryRequest {
  /** Client-generated UUIDv7 for the reversal entry. */
  id: Uuid;

  /** Which member is deleting. v1 has no authenticated identity. */
  requested_by: Uuid;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

model ErrorBody {
  error: string;
}

@error
model ErrorResponse<Status> {
  @statusCode statusCode: Status;
  @body body: ErrorBody;
}

/**
 * Write acknowledgement. Writes return the new entry's id and the ledger
 * sequence it was assigned — *not* the full entry. Re-read the ledger via
 * list-entries to see the record itself; `seq` is the cursor to read from.
 */
model EntryAck {
  id: Uuid;
  seq: int64;
}

/** Acknowledgement of a reversal, naming the entry it retired. */
model ReversalAck {
  ...EntryAck;
  reverses_id: Uuid;
}

/**
 * Acknowledgement of an edit. `id`/`seq` are the *replacement* entry;
 * `reversal_id` is the reversal that retired the original.
 */
model EditAck {
  ...EntryAck;
  reversal_id: Uuid;
}

/** The write was accepted and appended to the ledger. */
model Created<Body> {
  @statusCode statusCode: 201;
  @body body: Body;
}

/**
 * Replay: this `Idempotency-Key` already succeeded, and the body is the
 * snapshot stored from that original write, byte-identical to what the first
 * request returned. Not an error — treat as success.
 */
model Replayed<Body> {
  @statusCode statusCode: 200;
  @body body: Body;
}

/**
 * Errors shared by every write path.
 *
 * - `400` malformed body, bad id, or missing `Idempotency-Key`
 * - `409` a request with this key is in flight; retry shortly
 * - `422` domain rejected the write, or the key was reused with a different payload
 * - `500` the idempotency gate or the write itself failed
 */
alias WriteErrors = ErrorResponse<400> | ErrorResponse<409> | ErrorResponse<422> | ErrorResponse<500>;

/** `404` on top of the shared write errors: the target entry does not exist. */
alias CorrectionErrors = WriteErrors | ErrorResponse<404>;

alias ReadErrors = ErrorResponse<400> | ErrorResponse<500>;

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

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
): Created<EntryAck> | Replayed<EntryAck> | WriteErrors;

/**
 * Reverse an entry. Appends a reversal rather than deleting, so history and
 * balances stay derivable. Reversing an already-reversed entry is 409.
 */
@route("/groups/{group_id}/entries/{entry_id}/reverse")
@post
op reverseEntry(
  @path group_id: Uuid,
  @path entry_id: Uuid,
  @header("Idempotency-Key") idempotencyKey: Uuid,
  @body reversal: ReverseEntryRequest,
): Created<ReversalAck> | Replayed<ReversalAck> | CorrectionErrors;

/**
 * Edit an entry: reverse the original and append the replacement in one
 * transaction. The response body is the replacement entry.
 */
@route("/groups/{group_id}/entries/{entry_id}")
@put
op editEntry(
  @path group_id: Uuid,
  @path entry_id: Uuid,
  @header("Idempotency-Key") idempotencyKey: Uuid,
  @body entry: EditEntryRequest,
): Created<EditAck> | Replayed<EditAck> | CorrectionErrors;

/** Current net position of every group member, with the seq they reflect. */
@route("/groups/{group_id}/balance")
@get
op getBalance(@path group_id: Uuid): BalanceSnapshot | ReadErrors;

/**
 * Page the ledger in `seq` order. Poll by passing the highest `seq` seen as
 * `after_seq`.
 *
 * `limit` is clamped server-side, not rejected: values below 1 become 100, and
 * values above 500 become 500.
 */
@route("/groups/{group_id}/entries")
@get
op listEntries(
  @path group_id: Uuid,

  /** Exclusive cursor. Absent means from the start of the ledger. */
  @query after_seq?: int64,

  @query limit?: int32,
): EntryList | ReadErrors;
