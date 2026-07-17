// Package entry defines the write path's entry-creation port: the request
// shape the application layer builds, and the repository/idempotency-gate
// contracts infrastructure/postgres implements to persist it.
package entry

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/domain/ledger"
)

// ErrDuplicateID means an entry with this client-generated id already exists.
var ErrDuplicateID = errors.New("entry id already exists")

// Input is everything Repository.Create needs to persist one entry and its
// postings.
type Input struct {
	ID           uuid.UUID
	GroupID      uuid.UUID
	Kind         string
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
