package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// IntegrityReport is the result of the architecture.md §5 integrity checks.
// All-zero means the ledger's invariants hold.
type IntegrityReport struct {
	GlobalSum               int64 `json:"global_sum"`
	EntriesWithNonzeroSum   int   `json:"entries_with_nonzero_sum"`
	DoublyReversedOriginals int   `json:"doubly_reversed_originals"`
}

func (r IntegrityReport) OK() bool {
	return r.GlobalSum == 0 && r.EntriesWithNonzeroSum == 0 && r.DoublyReversedOriginals == 0
}

// IntegrityRepository runs the architecture.md §5 integrity checks over
// generated queries. Each check is an independent statement, same as before.
type IntegrityRepository struct {
	*BaseRepository
}

func NewIntegrityRepository(pool *pgxpool.Pool) *IntegrityRepository {
	return &IntegrityRepository{BaseRepository: NewBaseRepository(pool)}
}

func (r *IntegrityRepository) CheckIntegrity(ctx context.Context) (IntegrityReport, error) {
	q := r.queries(ctx)
	var rep IntegrityReport

	sum, err := q.SumAllPostings(ctx)
	if err != nil {
		return rep, err
	}
	rep.GlobalSum = sum

	nonzero, err := q.CountEntriesWithNonzeroPostingSum(ctx)
	if err != nil {
		return rep, err
	}
	rep.EntriesWithNonzeroSum = int(nonzero)

	doublyReversed, err := q.CountDoublyReversedOriginals(ctx)
	if err != nil {
		return rep, err
	}
	rep.DoublyReversedOriginals = int(doublyReversed)

	return rep, nil
}
