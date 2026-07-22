package postgres

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"tallyup/internal/domain/group"
	"tallyup/internal/infrastructure/postgres/sqlc"
)

var _ group.MembershipChecker = (*MembershipRepository)(nil)

// MembershipRepository answers group-membership questions over Postgres. It is
// a standalone check for callers outside the entry write path, which enforces
// membership itself inside its own transaction.
type MembershipRepository struct {
	*BaseRepository
}

func NewMembershipRepository(pool *pgxpool.Pool) *MembershipRepository {
	return &MembershipRepository{BaseRepository: NewBaseRepository(pool)}
}

// AllMembers reports whether every id in memberIDs belongs to groupID.
// Duplicate ids are counted once so a repeated valid member never fails the
// check.
func (r *MembershipRepository) AllMembers(ctx context.Context, groupID uuid.UUID, memberIDs []uuid.UUID) (bool, error) {
	ids := dedup(memberIDs)
	n, err := r.queries(ctx).CountGroupMembers(ctx, sqlc.CountGroupMembersParams{
		GroupID:   groupID,
		MemberIds: ids,
	})
	if err != nil {
		return false, err
	}
	return int(n) == len(ids), nil
}

func dedup(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]bool, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
