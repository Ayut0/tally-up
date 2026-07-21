package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"tallyup/internal/domain/entry"
)

var _ entry.Reverser = (*Store)(nil)

// reverseWithinTx locks the original, rejects double/invalid reversals, and
// appends the reversal entry + negated postings. Caller owns the transaction.
func reverseWithinTx(ctx context.Context, tx pgx.Tx, groupID, originalID, reversalID, requestedBy uuid.UUID) (int64, error) {
	var kind string
	var payer uuid.UUID
	var counterparty *uuid.UUID
	var total int64
	var participants []uuid.UUID
	var occurredOn time.Time
	err := tx.QueryRow(ctx, `
		SELECT kind, payer_id, counterparty, total_amount, participants, occurred_on
		FROM entries WHERE id = $1 AND group_id = $2
		FOR UPDATE`, originalID, groupID).
		Scan(&kind, &payer, &counterparty, &total, &participants, &occurredOn)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, entry.ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if entry.Kind(kind) == entry.KindReversal {
		return 0, entry.ErrNotReversible
	}

	var alreadyReversed bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM entries WHERE reverses_id = $1)`,
		originalID).Scan(&alreadyReversed); err != nil {
		return 0, err
	}
	if alreadyReversed {
		return 0, entry.ErrAlreadyReversed
	}

	var seq int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO entries (id, group_id, kind, reverses_id, payer_id, counterparty,
		                     total_amount, split_rule, participants, occurred_on, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'{"type":"reversal"}',$8,$9,$10)
		RETURNING seq`,
		reversalID, groupID, string(entry.KindReversal), originalID, payer, counterparty, total,
		participants, occurredOn, requestedBy).Scan(&seq); err != nil {
		return 0, err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO postings (entry_id, member_id, amount)
		SELECT $1, member_id, -amount FROM postings WHERE entry_id = $2`,
		reversalID, originalID); err != nil {
		return 0, err
	}
	return seq, nil
}

// Reverse appends a kind='reversal' entry whose postings are the exact
// negation of the original's. FOR UPDATE on the original serializes
// concurrent reversal attempts: the loser re-checks after the winner commits
// and sees the reversal (row locks don't fire the append-only trigger —
// only real UPDATE/DELETE do).
func (s *Store) Reverse(ctx context.Context, key uuid.UUID, groupID, originalID, reversalID, requestedBy uuid.UUID) ([]byte, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	seq, err := reverseWithinTx(ctx, tx, groupID, originalID, reversalID, requestedBy)
	if err != nil {
		return nil, err
	}

	snapshot := []byte(fmt.Sprintf(`{"id":%q,"seq":%d,"reverses_id":%q}`, reversalID, seq, originalID))
	var resp []byte
	if err := tx.QueryRow(ctx,
		`UPDATE idempotency_keys SET status='succeeded', response_body=$2 WHERE key=$1
		 RETURNING response_body`, key, snapshot).Scan(&resp); err != nil {
		return nil, err
	}
	return resp, tx.Commit(ctx)
}
