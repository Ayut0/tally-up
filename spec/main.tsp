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
// Group models
// ---------------------------------------------------------------------------

model Member {
  id: Uuid;
  name: string;
}

/** A group and its members, as persisted and returned by the server. */
model GroupRecord {
  id: Uuid;
  name: string;
  members: Member[];
}

/**
 * What the client sends to create a group and its initial members in one
 * call. `id` is client-generated, same reload-safety rationale as an entry's
 * id (architecture.md §4): a page reload loses in-flight idempotency-key
 * state, but the id itself still guards against a duplicate create.
 */
model CreateGroupRequest {
  id: Uuid;
  name: string;
  member_names: string[];
}

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

  /**
   * Absent for `kind: "settlement"` and `kind: "reversal"` — neither
   * derives its postings from a split rule (a settlement's come from
   * `payer_id`/`counterparty`, a reversal's are copied/negated from the
   * original), so there is no real value to report.
   */
  split_rule?: SplitRule;

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

/**
 * One nonzero debt relationship between two members, derived from
 * entries+postings: `debtor_id` owes `creditor_id` `amount`. `amount` is
 * always positive; zero-net pairs are never returned.
 */
model PairwiseBalance {
  debtor_id: Uuid;
  creditor_id: Uuid;
  amount: int64;
}

model PairwiseBalances {
  balances: PairwiseBalance[];
}

/** One proposed payment in a settle-up plan. */
model Transfer {
  from: Uuid;
  to: Uuid;
  amount: int64;
}

/**
 * Proposed transfers plus the balance snapshot they were computed from.
 * `as_of_seq` is the optimistic-concurrency token a recorded settlement
 * passes back as `plan_seq`.
 */
model SettlePlan {
  transfers: Transfer[];
  as_of_seq: int64;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Fields every new entry carries regardless of kind. */
model EntryRequestCommon {
  /** Client-generated UUIDv7. Required — the server does not mint entry ids. */
  id: Uuid;

  /** Which member is recording this. v1 has no authenticated identity. */
  requested_by: Uuid;

  payer_id: Uuid;

  /** Minor currency units. Must be in `(0, 100_000_000_000]`. */
  total_amount: int64;

  memo?: string;
  occurred_on: CalendarDate;
}

/** An expense: `total_amount` is divided among `participants` per `split_rule`. */
model ExpenseEntry {
  ...EntryRequestCommon;
  kind: "expense";
  split_rule: SplitRule;

  /** Must be non-empty and free of duplicates. */
  participants: Uuid[];
}

/**
 * A settlement: a direct payment from `payer_id` to `counterparty`, with no
 * split. The server derives postings and participants from `payer_id` and
 * `counterparty` alone (addentry.ComputePostings) — `split_rule` does not
 * apply and is not accepted here.
 */
model SettlementEntry {
  ...EntryRequestCommon;
  kind: "settlement";

  /** The member being paid. */
  counterparty: Uuid;
}

/**
 * What the client sends to record a new entry. `kind: "reversal"` cannot be
 * created this way — a reversal is always the side effect of the `/reverse`
 * or edit endpoints, never a direct POST.
 */
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union CreateEntryRequest {
  expense: ExpenseEntry,
  settlement: SettlementEntry,
}

/**
 * Editing is a correction, not a mutation: the original is reversed and a
 * replacement is appended, so the ledger stays append-only. Same kind-shaped
 * split as CreateEntryRequest, plus the reversal that retires the original.
 */
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union EditEntryRequest {
  expense: ExpenseEdit,
  settlement: SettlementEdit,
}

model ExpenseEdit {
  ...ExpenseEntry;
  reversal_entry_id: ReversalEntryId;
}

model SettlementEdit {
  ...SettlementEntry;
  reversal_entry_id: ReversalEntryId;
}

/**
 * Client-generated UUIDv7 for the reversal entry that retires the original.
 * Points the opposite way from `reverses_id`, which is a reversal's pointer
 * at the entry it reverses.
 */
alias ReversalEntryId = Uuid;

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
 * Acknowledgement of an edit. `id`/`seq` are the *replacement* entry, which
 * reverses nothing and so has no `reverses_id` of its own; `reversal_entry_id`
 * is the separate reversal that retired the original.
 */
model EditAck {
  ...EntryAck;
  reversal_entry_id: Uuid;
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

/** `404` on top of the shared read errors: the target group does not exist. */
alias GroupReadErrors = ReadErrors | ErrorResponse<404>;

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Create a group and its initial members in one call. Same idempotency
 * contract as createEntry: a retry that lands after the original succeeded
 * returns 200 with the original body.
 */
@route("/groups")
@post
op createGroup(
  @header("Idempotency-Key") idempotencyKey: Uuid,
  @body group: CreateGroupRequest,
): Created<GroupRecord> | Replayed<GroupRecord> | WriteErrors;

/** Fetch a group and its members. */
@route("/groups/{group_id}")
@get
op getGroup(@path group_id: Uuid): GroupRecord | GroupReadErrors;

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
 * transaction. The response body is an EditAck, not the full replacement
 * entry — same as create and reverse, re-read via list-entries to see it.
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

/** Proposed minimal transfers to settle up, plus the snapshot seq they were computed from. */
@route("/groups/{group_id}/settle-plan")
@get
op getSettlePlan(@path group_id: Uuid): SettlePlan | ReadErrors;

/**
 * True "who owes whom" between every pair of members — distinct from
 * `getSettlePlan`'s minimal-transfer proposal.
 */
@route("/groups/{group_id}/pairwise-balances")
@get
op getPairwiseBalances(@path group_id: Uuid): PairwiseBalances | ReadErrors;

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
