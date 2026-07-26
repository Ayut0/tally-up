package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
	"tallyup/internal/infrastructure/postgres/sqlc"
)

var _ entry.Reverser = (*EntryRepository)(nil)

// reverseWithinTx locks the original, rejects double/invalid reversals, and
// appends the reversal entry + negated postings. Caller owns the transaction
// via q.
func reverseWithinTx(ctx context.Context, q *sqlc.Queries, groupID, originalID, reversalID, requestedBy uuid.UUID) (int64, error) {
	original, err := q.LockEntryForUpdate(ctx, sqlc.LockEntryForUpdateParams{ID: originalID, GroupID: groupID})
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, entry.ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if entry.Kind(original.Kind) == entry.KindReversal {
		return 0, entry.ErrNotReversible
	}

	alreadyReversed, err := q.IsAlreadyReversed(ctx, &originalID)
	if err != nil {
		return 0, err
	}
	if alreadyReversed {
		return 0, entry.ErrAlreadyReversed
	}

	seq, err := q.InsertReversalEntry(ctx, sqlc.InsertReversalEntryParams{
		ID: reversalID, GroupID: groupID, ReversesID: &originalID, PayerID: original.PayerID,
		Counterparty: original.Counterparty, TotalAmount: original.TotalAmount,
		Participants: original.Participants, OccurredOn: original.OccurredOn, CreatedBy: requestedBy,
	})
	if err != nil {
		return 0, err
	}

	if err := q.CopyNegatedPostings(ctx, sqlc.CopyNegatedPostingsParams{
		ReversalEntryID: reversalID, OriginalEntryID: originalID,
	}); err != nil {
		return 0, err
	}
	return *seq, nil
}

// Reverse appends a kind='reversal' entry whose postings are the exact
// negation of the original's. FOR UPDATE on the original serializes
// concurrent reversal attempts: the loser re-checks after the winner commits
// and sees the reversal (row locks don't fire the append-only trigger —
// only real UPDATE/DELETE do).
func (r *EntryRepository) Reverse(ctx context.Context, key uuid.UUID, groupID, originalID, reversalID, requestedBy uuid.UUID) ([]byte, error) {
	var resp []byte
	err := r.tx.Do(ctx, func(ctx context.Context) error {
		q := r.queries(ctx)

		seq, err := reverseWithinTx(ctx, q, groupID, originalID, reversalID, requestedBy)
		if err != nil {
			return err
		}

		snapshot := fmt.Appendf(nil, `{"id":%q,"seq":%d,"reverses_id":%q}`, reversalID, seq, originalID)
		resp, err = q.MarkIdempotencySucceeded(ctx, sqlc.MarkIdempotencySucceededParams{
			Key: key, ResponseBody: snapshot,
		})
		return err
	})
	return resp, err
}

var _ entry.Editor = (*EntryRepository)(nil)

// Edit = reversal + replacement in one transaction (architecture.md §3):
// either both land or neither does. Reuses the same InsertEntry/InsertPosting
// queries Create uses, rather than duplicating the insert.
func (r *EntryRepository) Edit(ctx context.Context, key uuid.UUID, groupID, originalID, reversalID uuid.UUID, in entry.Input, postings []ledger.Posting) ([]byte, error) {
	if err := assertZeroSum(postings); err != nil {
		return nil, err
	}

	var resp []byte
	err := r.tx.Do(ctx, func(ctx context.Context) error {
		q := r.queries(ctx)

		if _, err := reverseWithinTx(ctx, q, groupID, originalID, reversalID, in.CreatedBy); err != nil {
			return err
		}

		seq, err := insertEntryAndPostings(ctx, q, in, postings)
		if err != nil {
			return err
		}

		// id/seq are the replacement; reversal_entry_id is the reversal that
		// retired the original. Deliberately not reverses_id — the replacement
		// reverses nothing, it is a fresh entry.
		snapshot := fmt.Appendf(nil, `{"id":%q,"seq":%d,"reversal_entry_id":%q}`, in.ID, seq, reversalID)
		resp, err = q.MarkIdempotencySucceeded(ctx, sqlc.MarkIdempotencySucceededParams{
			Key: key, ResponseBody: snapshot,
		})
		return err
	})
	return resp, err
}
