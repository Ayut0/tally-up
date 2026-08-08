// Package group defines the write path's group-membership port, and the
// group-creation/read ports the application and infrastructure layers
// implement against.
package group

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNotMember means one or more referenced members are not part of the group.
var ErrNotMember = errors.New("payer, counterparty, and participants must all be group members")

// ErrDuplicateID means a group with this client-generated id already exists.
var ErrDuplicateID = errors.New("group id already exists")

// ErrNotFound means no group exists with the given id.
var ErrNotFound = errors.New("group not found")

// ErrNonzeroBalance means a member cannot be removed because they still owe
// or are owed money in this group.
var ErrNonzeroBalance = errors.New("member has a nonzero balance; settle up before removing")

// MembershipChecker verifies that every given member id belongs to the
// group. infrastructure/postgres's entry.Repository implementation enforces
// this itself, inside the same transaction as the entry insert — this port
// exists for callers that need a standalone check outside that transaction
// (e.g. future read-path and member-management use cases).
type MembershipChecker interface {
	AllMembers(ctx context.Context, groupID uuid.UUID, memberIDs []uuid.UUID) (bool, error)
}

// Member is one group member as returned by the server. The id is
// server-minted at creation time — the members table has no client-supplied
// identity, unlike a group or entry.
type Member struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// Record is a group and its members, as persisted and returned by the server.
type Record struct {
	ID      uuid.UUID `json:"id"`
	Name    string    `json:"name"`
	Members []Member  `json:"members"`
}

// Input is everything Repository.CreateGroup needs to persist a new group
// and mint its initial members. ID is client-generated, same reload-safety
// rationale as entry.Input.ID (architecture.md §4).
type Input struct {
	ID          uuid.UUID
	Name        string
	MemberNames []string
}

// Repository persists a new group and its initial members, atomically
// marking the owning idempotency key succeeded with the response snapshot —
// same shape as entry.Repository.Create.
type Repository interface {
	CreateGroup(ctx context.Context, idempotencyKey uuid.UUID, in Input) ([]byte, error)
}

// Reader is the read-side port for fetching a group — a pure query, no
// idempotency gate involved.
type Reader interface {
	GetGroup(ctx context.Context, id uuid.UUID) (Record, error)
}

// MemberAdder persists a new member and links them to a group, atomically
// marking the owning idempotency key succeeded with the response snapshot —
// same shape as Repository.CreateGroup.
type MemberAdder interface {
	AddMember(ctx context.Context, idempotencyKey uuid.UUID, groupID uuid.UUID, name string) ([]byte, error)
}

// MemberRemover unlinks a member from a group, blocked unless their balance
// is exactly zero (see ErrNonzeroBalance). Only the group_members row is
// removed; members and their historical entries/postings are untouched, so
// past history stays fully readable. Naturally idempotent — no idempotency
// gate needed, unlike MemberAdder.
type MemberRemover interface {
	RemoveMember(ctx context.Context, groupID, memberID uuid.UUID) error
}
