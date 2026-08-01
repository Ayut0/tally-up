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

	"tallyup/internal/application/proposesettleplan"
	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
)

// ErrCounterpartyRequired means a settlement entry was submitted without a
// counterparty.
var ErrCounterpartyRequired = errors.New("settlement requires counterparty")

// ErrUnknownKind means the entry kind is neither "expense" nor "settlement".
var ErrUnknownKind = errors.New("kind must be expense or settlement")

// ErrPlanSeqOnExpense means an expense carried a plan_seq. Settle plans gate
// settlements only, so this is a client bug rather than a stale plan.
var ErrPlanSeqOnExpense = errors.New("plan_seq applies to settlements only")

// ValidationError wraps a postings-computation failure (an invalid
// split_rule, amount, or participant list) that should be reported to the
// caller as a client error, not an internal one.
type ValidationError struct{ Err error }

func (e *ValidationError) Error() string { return e.Err.Error() }
func (e *ValidationError) Unwrap() error { return e.Err }

// GateError wraps an idempotency-gate acquisition failure (a DB-level error
// from IdempotencyGate.Acquire) so callers can report it distinctly from a
// persistence failure.
type GateError struct{ Err error }

func (e *GateError) Error() string { return e.Err.Error() }
func (e *GateError) Unwrap() error { return e.Err }

// PlanStale reports a settlement rejected because the ledger moved past the
// settle plan it was recorded against, carrying a plan recomputed from
// current balances so the caller can re-propose in one round trip. Unwraps to
// the domain's *entry.PlanStaleError.
type PlanStale struct {
	Stale *entry.PlanStaleError
	Plan  proposesettleplan.Result
}

func (e *PlanStale) Error() string { return e.Stale.Error() }
func (e *PlanStale) Unwrap() error { return e.Stale }

// PlanProposer recomputes a group's settle plan for the body of a stale-plan
// rejection. Satisfied by *proposesettleplan.Service; declared here as an
// interface so this package depends on the capability it needs rather than a
// concrete sibling service.
type PlanProposer interface {
	Propose(ctx context.Context, groupID uuid.UUID) (proposesettleplan.Result, error)
}

// Command is everything AddEntry needs to create one entry.
type Command struct {
	ID             uuid.UUID
	GroupID        uuid.UUID
	Kind           entry.Kind
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

	// PlanSeq is the settle plan's as_of_seq when this settlement came from a
	// proposed plan. Settlements only; nil skips the staleness check.
	PlanSeq *int64
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
	Plans   PlanProposer
}

func (s *Service) AddEntry(ctx context.Context, cmd Command) (Result, error) {
	postings, splitJSON, participants, err := ComputePostings(cmd)
	if err != nil {
		return Result{}, err
	}

	gate, stored, err := s.Gate.Acquire(ctx, cmd.IdempotencyKey, cmd.RequestHash)
	if err != nil {
		return Result{}, &GateError{Err: err}
	}
	if gate != entry.GateProceed {
		return Result{Gate: gate, Body: stored}, nil
	}

	resp, err := s.Entries.Create(ctx, cmd.IdempotencyKey, entry.Input{
		ID: cmd.ID, GroupID: cmd.GroupID, Kind: cmd.Kind, PayerID: cmd.PayerID,
		Counterparty: cmd.Counterparty, TotalAmount: cmd.TotalAmount,
		SplitRule: splitJSON, Participants: participants, Memo: cmd.Memo,
		OccurredOn: cmd.OccurredOn, CreatedBy: cmd.CreatedBy,
		PlanSeq: cmd.PlanSeq,
	}, postings)
	if err != nil {
		// We own the pending row; free it so the client's retry isn't stuck
		// behind the janitor. Best-effort — the janitor is the backstop.
		if relErr := s.Gate.Release(ctx, cmd.IdempotencyKey); relErr != nil {
			slog.Warn("release idempotency key", "key", cmd.IdempotencyKey, "err", relErr)
		}
		return Result{}, s.explainStalePlan(ctx, cmd.GroupID, err)
	}
	return Result{Gate: entry.GateProceed, Body: resp}, nil
}

// explainStalePlan upgrades the domain's bare staleness verdict into one that
// carries a freshly recomputed plan, so the caller can hand the client
// something usable instead of just "your plan expired". Any other error, and
// any failure to recompute, passes through unchanged — a stale plan the
// client cannot replace is an ordinary failure, not a 409 it can act on.
func (s *Service) explainStalePlan(ctx context.Context, groupID uuid.UUID, err error) error {
	var stale *entry.PlanStaleError
	if !errors.As(err, &stale) {
		return err
	}
	plan, planErr := s.Plans.Propose(ctx, groupID)
	if planErr != nil {
		slog.Error("recompute settle plan for stale-plan rejection",
			"group_id", groupID, "err", planErr)
		return err
	}
	return &PlanStale{Stale: stale, Plan: plan}
}

func ComputePostings(cmd Command) (postings []ledger.Posting, splitJSON []byte, participants []uuid.UUID, err error) {
	participants = cmd.Participants
	switch cmd.Kind {
	case entry.KindExpense:
		if cmd.PlanSeq != nil {
			return nil, nil, nil, &ValidationError{Err: ErrPlanSeqOnExpense}
		}
		postings, err = ledger.ComputePostings(cmd.PayerID, cmd.TotalAmount, cmd.SplitRule, cmd.Participants)
		if err == nil {
			splitJSON, err = json.Marshal(cmd.SplitRule)
		}
	case entry.KindSettlement:
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
