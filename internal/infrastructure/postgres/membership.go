package postgres

import (
	"context"

	"github.com/google/uuid"

	"tallyup/internal/domain/group"
)

var _ group.MembershipChecker = (*Store)(nil)

// AllMembers reports whether every id in memberIDs belongs to groupID. It is
// a standalone (non-transactional) check for callers outside the entry
// write path, which enforces membership itself inside its own transaction.
func (s *Store) AllMembers(ctx context.Context, groupID uuid.UUID, memberIDs []uuid.UUID) (bool, error) {
	uniq := make(map[uuid.UUID]bool, len(memberIDs))
	ids := make([]uuid.UUID, 0, len(memberIDs))
	for _, m := range memberIDs {
		if !uniq[m] {
			uniq[m] = true
			ids = append(ids, m)
		}
	}
	var cnt int
	if err := s.Pool.QueryRow(ctx,
		`SELECT count(*) FROM group_members WHERE group_id=$1 AND member_id = ANY($2)`,
		groupID, ids).Scan(&cnt); err != nil {
		return false, err
	}
	return cnt == len(ids), nil
}
