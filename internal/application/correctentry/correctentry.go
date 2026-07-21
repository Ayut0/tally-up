// Package correctentry implements the ledger's append-only correction
// model: reverse (delete) and edit, both as new entries that never mutate
// history. Same idempotency-gate orchestration shape as application/addentry.
package correctentry

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/application/addentry"
	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
)

// ReverseCommand is everything Reverse needs to append a reversal entry.
type ReverseCommand struct {
	GroupID        uuid.UUID
	OriginalID     uuid.UUID
	ReversalID     uuid.UUID
	RequestedBy    uuid.UUID
	IdempotencyKey uuid.UUID
	RequestHash    string
}

// EditCommand is everything Edit needs: the original to reverse plus the
// full replacement entry payload (same shape as addentry.Command).
type EditCommand struct {
	GroupID        uuid.UUID
	OriginalID     uuid.UUID
	ReversalID     uuid.UUID
	ID             uuid.UUID
	Kind           entry.Kind
	PayerID        uuid.UUID
	Counterparty   *uuid.UUID
	TotalAmount    int64
	SplitRule      ledger.SplitRule
	Participants   []uuid.UUID
	Memo           string
	OccurredOn     time.Time
	IdempotencyKey uuid.UUID
	RequestHash    string
}

// Result mirrors addentry.Result: Gate reports whether this call actually
// persisted (GateProceed) or short-circuited on the idempotency gate; Body
// is the response snapshot either way.
type Result struct {
	Gate entry.GateResult
	Body []byte
}

type Service struct {
	Gate     entry.IdempotencyGate
	Reverses entry.Reverser
	Edits    entry.Editor
}

func (s *Service) releaseGate(ctx context.Context, key uuid.UUID) {
	if err := s.Gate.Release(ctx, key); err != nil {
		slog.Warn("release idempotency key", "key", key, "err", err)
	}
}

func (s *Service) Reverse(ctx context.Context, cmd ReverseCommand) (Result, error) {
	gate, stored, err := s.Gate.Acquire(ctx, cmd.IdempotencyKey, cmd.RequestHash)
	if err != nil {
		return Result{}, &addentry.GateError{Err: err}
	}
	if gate != entry.GateProceed {
		return Result{Gate: gate, Body: stored}, nil
	}

	resp, err := s.Reverses.Reverse(ctx, cmd.IdempotencyKey, cmd.GroupID, cmd.OriginalID, cmd.ReversalID, cmd.RequestedBy)
	if err != nil {
		s.releaseGate(ctx, cmd.IdempotencyKey)
		return Result{}, err
	}
	return Result{Gate: entry.GateProceed, Body: resp}, nil
}

func (s *Service) Edit(ctx context.Context, cmd EditCommand) (Result, error) {
	postings, splitJSON, participants, err := addentry.ComputePostings(addentry.Command{
		Kind: cmd.Kind, PayerID: cmd.PayerID, Counterparty: cmd.Counterparty,
		TotalAmount: cmd.TotalAmount, SplitRule: cmd.SplitRule, Participants: cmd.Participants,
	})
	if err != nil {
		return Result{}, err
	}

	gate, stored, err := s.Gate.Acquire(ctx, cmd.IdempotencyKey, cmd.RequestHash)
	if err != nil {
		return Result{}, &addentry.GateError{Err: err}
	}
	if gate != entry.GateProceed {
		return Result{Gate: gate, Body: stored}, nil
	}

	resp, err := s.Edits.Edit(ctx, cmd.IdempotencyKey, cmd.GroupID, cmd.OriginalID, cmd.ReversalID, entry.Input{
		ID: cmd.ID, GroupID: cmd.GroupID, Kind: cmd.Kind, PayerID: cmd.PayerID,
		Counterparty: cmd.Counterparty, TotalAmount: cmd.TotalAmount,
		SplitRule: splitJSON, Participants: participants, Memo: cmd.Memo,
		OccurredOn: cmd.OccurredOn, CreatedBy: cmd.PayerID,
	}, postings)
	if err != nil {
		s.releaseGate(ctx, cmd.IdempotencyKey)
		return Result{}, err
	}
	return Result{Gate: entry.GateProceed, Body: resp}, nil
}
