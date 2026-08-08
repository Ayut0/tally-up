// Package addmember implements the write path's add-member application
// service: validate → idempotency gate → persist, orchestrating the
// domain/group ports. Validation happens before the gate is touched — pure
// validation costs nothing, and a bad request should never create a pending
// idempotency row (see architecture.md §7, same rationale as creategroup).
package addmember

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/group"
)

const maxMemberNameLen = 50

// ValidationError wraps a request-validation failure (a bad name) that
// should be reported to the caller as a client error, not an internal one.
type ValidationError struct{ Err error }

func (e *ValidationError) Error() string { return e.Err.Error() }
func (e *ValidationError) Unwrap() error { return e.Err }

// GateError wraps an idempotency-gate acquisition failure (a DB-level error
// from IdempotencyGate.Acquire) so callers can report it distinctly from a
// persistence failure.
type GateError struct{ Err error }

func (e *GateError) Error() string { return e.Err.Error() }
func (e *GateError) Unwrap() error { return e.Err }

// Command is everything AddMember needs to add one member to a group.
type Command struct {
	GroupID        uuid.UUID
	Name           string
	IdempotencyKey uuid.UUID
	RequestHash    string
}

// Result is AddMember's outcome. Gate reports whether this call actually
// persisted a new member (GateProceed) or short-circuited on the idempotency
// gate (Replay/InFlight/Mismatch); Body is the response snapshot to return
// to the caller either way. Result is only meaningful when AddMember returns
// a nil error.
type Result struct {
	Gate entry.GateResult
	Body []byte
}

type Service struct {
	Gate    entry.IdempotencyGate
	Members group.MemberAdder
}

func (s *Service) AddMember(ctx context.Context, cmd Command) (Result, error) {
	name := strings.TrimSpace(cmd.Name)
	if name == "" || len(name) > maxMemberNameLen {
		return Result{}, &ValidationError{Err: fmt.Errorf("member name must be 1-%d characters", maxMemberNameLen)}
	}

	gate, stored, err := s.Gate.Acquire(ctx, cmd.IdempotencyKey, cmd.RequestHash)
	if err != nil {
		return Result{}, &GateError{Err: err}
	}
	if gate != entry.GateProceed {
		return Result{Gate: gate, Body: stored}, nil
	}

	resp, err := s.Members.AddMember(ctx, cmd.IdempotencyKey, cmd.GroupID, name)
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
