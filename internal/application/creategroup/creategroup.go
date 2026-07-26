// Package creategroup implements the write path's group-creation application
// service: validate → idempotency gate → persist, orchestrating the
// domain/group ports. Validation happens before the gate is touched — pure
// validation costs nothing, and a bad request should never create a pending
// idempotency row (see architecture.md §7, same rationale as addentry).
package creategroup

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/group"
)

const (
	maxNameLen       = 100
	minMembers       = 1
	maxMembers       = 20
	maxMemberNameLen = 50
)

// ValidationError wraps a request-validation failure (a bad name or member
// list) that should be reported to the caller as a client error, not an
// internal one.
type ValidationError struct{ Err error }

func (e *ValidationError) Error() string { return e.Err.Error() }
func (e *ValidationError) Unwrap() error { return e.Err }

// GateError wraps an idempotency-gate acquisition failure (a DB-level error
// from IdempotencyGate.Acquire) so callers can report it distinctly from a
// persistence failure.
type GateError struct{ Err error }

func (e *GateError) Error() string { return e.Err.Error() }
func (e *GateError) Unwrap() error { return e.Err }

// Command is everything CreateGroup needs to create one group.
type Command struct {
	ID             uuid.UUID
	Name           string
	MemberNames    []string
	IdempotencyKey uuid.UUID
	RequestHash    string
}

// Result is CreateGroup's outcome. Gate reports whether this call actually
// persisted a new group (GateProceed) or short-circuited on the idempotency
// gate (Replay/InFlight/Mismatch); Body is the response snapshot to return
// to the caller either way. Result is only meaningful when CreateGroup
// returns a nil error.
type Result struct {
	Gate entry.GateResult
	Body []byte
}

type Service struct {
	Gate   entry.IdempotencyGate
	Groups group.Repository
}

func (s *Service) CreateGroup(ctx context.Context, cmd Command) (Result, error) {
	in, err := validate(cmd)
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

	resp, err := s.Groups.CreateGroup(ctx, cmd.IdempotencyKey, in)
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

// validate trims and length-checks the group name and member names, and
// returns the group.Input ready to persist.
func validate(cmd Command) (group.Input, error) {
	name := strings.TrimSpace(cmd.Name)
	if name == "" || len(name) > maxNameLen {
		return group.Input{}, &ValidationError{Err: fmt.Errorf("name must be 1-%d characters", maxNameLen)}
	}

	if len(cmd.MemberNames) < minMembers || len(cmd.MemberNames) > maxMembers {
		return group.Input{}, &ValidationError{Err: fmt.Errorf("must have %d-%d member names", minMembers, maxMembers)}
	}

	memberNames := make([]string, len(cmd.MemberNames))
	for i, raw := range cmd.MemberNames {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || len(trimmed) > maxMemberNameLen {
			return group.Input{}, &ValidationError{Err: fmt.Errorf("member name must be 1-%d characters", maxMemberNameLen)}
		}
		memberNames[i] = trimmed
	}

	return group.Input{ID: cmd.ID, Name: name, MemberNames: memberNames}, nil
}
