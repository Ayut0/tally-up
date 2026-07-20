// Package group defines the write path's group-membership port.
package group

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNotMember means one or more referenced members are not part of the group.
var ErrNotMember = errors.New("payer, counterparty, and participants must all be group members")

// MembershipChecker verifies that every given member id belongs to the
// group. infrastructure/postgres's entry.Repository implementation enforces
// this itself, inside the same transaction as the entry insert — this port
// exists for callers that need a standalone check outside that transaction
// (e.g. future read-path and member-management use cases).
type MembershipChecker interface {
	AllMembers(ctx context.Context, groupID uuid.UUID, memberIDs []uuid.UUID) (bool, error)
}
