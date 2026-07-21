package postgres

import (
	"context"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
)

var _ entry.BalanceReader = (*Store)(nil)

// GetBalances returns every group member's net position plus the max entry
// seq those balances reflect. Both come from ONE statement, hence one MVCC
// snapshot — as_of_seq is exactly the ledger state the balances derive from.
func (s *Store) GetBalances(ctx context.Context, groupID uuid.UUID) (entry.BalanceSnapshot, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT gm.member_id,
		       COALESCE(b.balance, 0),
		       (SELECT COALESCE(MAX(seq), 0) FROM entries e WHERE e.group_id = $1)
		FROM group_members gm
		LEFT JOIN balances b ON b.group_id = gm.group_id AND b.member_id = gm.member_id
		WHERE gm.group_id = $1
		ORDER BY gm.member_id`, groupID)
	if err != nil {
		return entry.BalanceSnapshot{}, err
	}
	defer rows.Close()

	snap := entry.BalanceSnapshot{Balances: []entry.MemberBalance{}}
	for rows.Next() {
		var mb entry.MemberBalance
		if err := rows.Scan(&mb.MemberID, &mb.Balance, &snap.AsOfSeq); err != nil {
			return entry.BalanceSnapshot{}, err
		}
		snap.Balances = append(snap.Balances, mb)
	}
	return snap, rows.Err()
}
