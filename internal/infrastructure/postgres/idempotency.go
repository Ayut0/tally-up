package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"tallyup/internal/domain/entry"
	"tallyup/internal/infrastructure/postgres/sqlc"
)

var _ entry.IdempotencyGate = (*IdempotencyRepository)(nil)

// IdempotencyRepository is the pending-row-first gate from architecture.md §4,
// backed by generated queries. Like every repository it resolves its query set
// through the ctx-bound session (see BaseRepository), so the gate behaves the
// same inside and outside a transaction.
type IdempotencyRepository struct {
	*BaseRepository
}

func NewIdempotencyRepository(pool *pgxpool.Pool) *IdempotencyRepository {
	return &IdempotencyRepository{BaseRepository: NewBaseRepository(pool)}
}

// Acquire claims the key for this request. The pending insert commits
// immediately (its own implicit txn) so a crash leaves a visible pending row
// for the janitor. Winning the insert (one row affected) means proceed;
// otherwise we classify the row we collided with.
func (r *IdempotencyRepository) Acquire(ctx context.Context, key uuid.UUID, requestHash string) (entry.GateResult, []byte, error) {
	q := r.queries(ctx)

	inserted, err := q.InsertIdempotencyKey(ctx, sqlc.InsertIdempotencyKeyParams{
		Key:         key,
		RequestHash: requestHash,
	})
	if err != nil {
		return 0, nil, err
	}
	if inserted == 1 {
		return entry.GateProceed, nil, nil
	}

	row, err := q.GetIdempotencyOutcome(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) {
		// Janitor deleted the row between our insert-conflict and this read;
		// tell the client to retry rather than racing to re-own it here.
		return entry.GateInFlight, nil, nil
	}
	if err != nil {
		return 0, nil, err
	}
	if row.RequestHash != requestHash {
		return entry.GateMismatch, nil, nil
	}
	if row.Status == "succeeded" {
		return entry.GateReplay, row.ResponseBody, nil
	}
	return entry.GateInFlight, nil, nil
}

// Release frees a pending key after a post-gate failure so the client can
// retry immediately instead of waiting for the janitor. Succeeded keys are
// never released: their response snapshot is the replay truth.
func (r *IdempotencyRepository) Release(ctx context.Context, key uuid.UUID) error {
	return r.queries(ctx).DeletePendingIdempotencyKey(ctx, key)
}

// SweepStalePending deletes pending rows older than olderThan so crashed
// requests can be retried cleanly.
func (r *IdempotencyRepository) SweepStalePending(ctx context.Context, olderThan time.Duration) (int64, error) {
	return r.queries(ctx).SweepStalePendingIdempotencyKeys(ctx, olderThan.Seconds())
}
