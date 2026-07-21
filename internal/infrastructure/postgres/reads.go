package postgres

import (
	"context"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
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

var _ entry.HistoryReader = (*Store)(nil)

// ListEntries pages the ledger in seq order. No transaction needed: visible
// entries and postings are immutable (append-only), so two queries cannot
// disagree about rows they both see.
func (s *Store) ListEntries(ctx context.Context, groupID uuid.UUID, afterSeq int64, limit int) ([]entry.Record, error) {
	if limit < 1 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, seq, kind, reverses_id, payer_id, counterparty, total_amount,
		       split_rule, participants, memo,
		       to_char(occurred_on, 'YYYY-MM-DD'), created_by, created_at
		FROM entries
		WHERE group_id = $1 AND seq > $2
		ORDER BY seq
		LIMIT $3`, groupID, afterSeq, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []entry.Record{}
	index := map[uuid.UUID]int{}
	ids := []uuid.UUID{}
	for rows.Next() {
		var e entry.Record
		var kind string
		if err := rows.Scan(&e.ID, &e.Seq, &kind, &e.ReversesID, &e.PayerID,
			&e.Counterparty, &e.TotalAmount, &e.SplitRule, &e.Participants,
			&e.Memo, &e.OccurredOn, &e.CreatedBy, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Kind = entry.Kind(kind)
		e.Postings = []ledger.Posting{}
		index[e.ID] = len(entries)
		ids = append(ids, e.ID)
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return entries, nil
	}

	prows, err := s.Pool.Query(ctx, `
		SELECT entry_id, member_id, amount FROM postings
		WHERE entry_id = ANY($1)
		ORDER BY entry_id, member_id`, ids)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	for prows.Next() {
		var entryID uuid.UUID
		var p ledger.Posting
		if err := prows.Scan(&entryID, &p.MemberID, &p.Amount); err != nil {
			return nil, err
		}
		i := index[entryID]
		entries[i].Postings = append(entries[i].Postings, p)
	}
	return entries, prows.Err()
}
