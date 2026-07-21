// Package entry defines the write path's entry-creation port: the request
// shape the application layer builds, and the repository/idempotency-gate
// contracts infrastructure/postgres implements to persist it.
package entry

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/domain/ledger"
)

// ErrDuplicateID means an entry with this client-generated id already exists.
var ErrDuplicateID = errors.New("entry id already exists")

// Sentinel errors for the correction path (Reverse/Edit).
var (
	ErrNotFound        = errors.New("entry not found in this group")
	ErrAlreadyReversed = errors.New("entry already reversed")
	ErrNotReversible   = errors.New("reversal entries cannot be reversed")
)

// Kind is the entry's type. Go has no sum type, so this is the idiomatic
// approximation — a named string with the two valid values as constants
// (mirroring ledger.SplitType). It documents the field and gives the values a
// canonical home; the exhaustive check still lives in the application layer.
type Kind string

const (
	KindExpense    Kind = "expense"
	KindSettlement Kind = "settlement"
	KindReversal   Kind = "reversal"
)

// Input is everything Repository.Create needs to persist one entry and its
// postings.
type Input struct {
	ID           uuid.UUID
	GroupID      uuid.UUID
	Kind         Kind
	PayerID      uuid.UUID
	Counterparty *uuid.UUID
	TotalAmount  int64
	SplitRule    []byte // raw JSON, stored verbatim
	Participants []uuid.UUID
	Memo         string
	OccurredOn   time.Time
	CreatedBy    uuid.UUID
}

// Repository persists a fully computed entry and its postings, atomically
// marking the owning idempotency key succeeded with the response snapshot.
// The Postgres implementation validates group membership inside the same
// transaction as the insert (see domain/group), so this single call is the
// entire atomic unit of work — callers never split it across two round
// trips.
type Repository interface {
	Create(ctx context.Context, idempotencyKey uuid.UUID, in Input, postings []ledger.Posting) ([]byte, error)
}

// GateResult is the outcome of an idempotency-gate acquisition attempt.
type GateResult int

const (
	GateProceed  GateResult = iota // this request owns the operation
	GateReplay                     // already succeeded; caller should return the stored body
	GateInFlight                   // another request holds a pending row
	GateMismatch                   // same key, different payload — client bug
)

// IdempotencyGate implements the pending-row-first gate from
// architecture.md §4.
type IdempotencyGate interface {
	Acquire(ctx context.Context, key uuid.UUID, requestHash string) (GateResult, []byte, error)
	Release(ctx context.Context, key uuid.UUID) error
}

// MemberBalance is one member's net position: positive = is owed, negative
// = owes.
type MemberBalance struct {
	MemberID uuid.UUID `json:"member_id"`
	Balance  int64     `json:"balance"`
}

// BalanceSnapshot is every group member's balance plus the max entry seq
// those balances reflect — both read from one SQL statement (one MVCC
// snapshot), so AsOfSeq is exactly the ledger state the balances derive
// from. This is the optimistic-concurrency token a future settle-up plan
// builds on.
type BalanceSnapshot struct {
	Balances []MemberBalance `json:"balances"`
	AsOfSeq  int64           `json:"as_of_seq"`
}

// Record is one entry plus its postings, as returned by ledger history.
type Record struct {
	ID           uuid.UUID        `json:"id"`
	Seq          int64            `json:"seq"`
	Kind         Kind             `json:"kind"`
	ReversesID   *uuid.UUID       `json:"reverses_id,omitempty"`
	PayerID      uuid.UUID        `json:"payer_id"`
	Counterparty *uuid.UUID       `json:"counterparty,omitempty"`
	TotalAmount  int64            `json:"total_amount"`
	SplitRule    json.RawMessage  `json:"split_rule"`
	Participants []uuid.UUID      `json:"participants"`
	Memo         *string          `json:"memo,omitempty"`
	OccurredOn   string           `json:"occurred_on"`
	CreatedBy    uuid.UUID        `json:"created_by"`
	CreatedAt    time.Time        `json:"created_at"`
	Postings     []ledger.Posting `json:"postings"`
}

// BalanceReader is the read-side port for derived balances — a pure query,
// no idempotency gate involved.
type BalanceReader interface {
	GetBalances(ctx context.Context, groupID uuid.UUID) (BalanceSnapshot, error)
}

// HistoryReader is the read-side port for paginated ledger history — a
// pure query, no idempotency gate involved.
type HistoryReader interface {
	ListEntries(ctx context.Context, groupID uuid.UUID, afterSeq int64, limit int) ([]Record, error)
}

// Reverser persists a reversal — the delete half of the append-only
// correction model. Reverse appends a negated-postings entry referencing
// the original, enforcing "reversed at most once" via a row lock on it.
type Reverser interface {
	Reverse(ctx context.Context, idempotencyKey uuid.UUID, groupID, originalID, reversalID, requestedBy uuid.UUID) ([]byte, error)
}
