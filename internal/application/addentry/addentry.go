// Package addentry implements the write path's application service:
// compute postings → idempotency gate → persist, orchestrating the
// domain/entry ports. Postings are computed before the gate is touched —
// pure validation costs nothing, and a bad request should never create a
// pending idempotency row (see architecture.md §7).
package addentry

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
)

// ErrCounterpartyRequired means a settlement entry was submitted without a
// counterparty.
var ErrCounterpartyRequired = errors.New("settlement requires counterparty")

// ErrUnknownKind means the entry kind is neither "expense" nor "settlement".
var ErrUnknownKind = errors.New("kind must be expense or settlement")

// ValidationError wraps a postings-computation failure (an invalid
// split_rule, amount, or participant list) that should be reported to the
// caller as a client error, not an internal one.
type ValidationError struct{ Err error }

func (e *ValidationError) Error() string { return e.Err.Error() }
func (e *ValidationError) Unwrap() error { return e.Err }

// Command is everything AddEntry needs to create one entry.
type Command struct {
	ID             uuid.UUID
	GroupID        uuid.UUID
	Kind           string
	PayerID        uuid.UUID
	Counterparty   *uuid.UUID
	TotalAmount    int64
	SplitRule      ledger.SplitRule
	Participants   []uuid.UUID
	Memo           string
	OccurredOn     time.Time
	CreatedBy      uuid.UUID
	IdempotencyKey uuid.UUID
	RequestHash    string
}

// Result is AddEntry's outcome. Gate reports whether this call actually
// persisted a new entry (GateProceed) or short-circuited on the idempotency
// gate (Replay/InFlight/Mismatch); Body is the response snapshot to return
// to the caller either way. Result is only meaningful when AddEntry returns
// a nil error.
type Result struct {
	Gate entry.GateResult
	Body []byte
}

type Service struct {
	Gate    entry.IdempotencyGate
	Entries entry.Repository
}

func (s *Service) AddEntry(ctx context.Context, cmd Command) (Result, error) {
	postings, splitJSON, participants, err := computePostings(cmd)
	if err != nil {
		return Result{}, err
	}

	gate, stored, err := s.Gate.Acquire(ctx, cmd.IdempotencyKey, cmd.RequestHash)
	if err != nil {
		return Result{}, err
	}
	if gate != entry.GateProceed {
		return Result{Gate: gate, Body: stored}, nil
	}

	resp, err := s.Entries.Create(ctx, cmd.IdempotencyKey, entry.Input{
		ID: cmd.ID, GroupID: cmd.GroupID, Kind: cmd.Kind, PayerID: cmd.PayerID,
		Counterparty: cmd.Counterparty, TotalAmount: cmd.TotalAmount,
		SplitRule: splitJSON, Participants: participants, Memo: cmd.Memo,
		OccurredOn: cmd.OccurredOn, CreatedBy: cmd.CreatedBy,
	}, postings)
	if err != nil {
		// We own the pending row; free it so the client's retry isn't stuck
		// behind the janitor. Best-effort — the janitor is the backstop.
		if relErr := s.Gate.Release(ctx, cmd.IdempotencyKey); relErr != nil {
			slog.Warn("release idempotency key", "key", cmd.IdempotencyKey, "err", relErr)
		}
		return Result{}, err
	}
	return Result{Gate: entry.GateProceed, Body: resp}, nil
}

func computePostings(cmd Command) (postings []ledger.Posting, splitJSON []byte, participants []uuid.UUID, err error) {
	participants = cmd.Participants
	switch cmd.Kind {
	case "expense":
		postings, err = ledger.ComputePostings(cmd.PayerID, cmd.TotalAmount, cmd.SplitRule, cmd.Participants)
		if err == nil {
			splitJSON, err = json.Marshal(cmd.SplitRule)
		}
	case "settlement":
		if cmd.Counterparty == nil {
			return nil, nil, nil, ErrCounterpartyRequired
		}
		postings, err = ledger.SettlementPostings(cmd.PayerID, *cmd.Counterparty, cmd.TotalAmount)
		// "settlement" is not one of ledger.SplitType's four constants (equal/exact/
		// shares/percent) — harmless today since nothing recomputes postings from
		// split_rule, but a future feature deserializing split_rule to recompute
		// postings must special-case kind == "settlement" rather than treating this
		// as a ledger.SplitType.
		splitJSON = []byte(`{"type":"settlement"}`)
		participants = []uuid.UUID{cmd.PayerID, *cmd.Counterparty}
	default:
		return nil, nil, nil, ErrUnknownKind
	}
	if err != nil {
		return nil, nil, nil, &ValidationError{Err: err}
	}
	return postings, splitJSON, participants, nil
}
