package postgres

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
	"tallyup/internal/infrastructure/postgres/sqlc"
)

// ReadRepository answers the read-side ports (balances, ledger history) over
// generated queries. No transaction is needed: visible entries and postings
// are immutable (append-only), so two queries in ListEntries cannot disagree
// about rows they both see.
type ReadRepository struct {
	*BaseRepository
}

func NewReadRepository(pool *pgxpool.Pool) *ReadRepository {
	return &ReadRepository{BaseRepository: NewBaseRepository(pool)}
}

var _ entry.BalanceReader = (*ReadRepository)(nil)

// GetBalances returns every group member's net position plus the max entry
// seq those balances reflect. Both come from ONE statement, hence one MVCC
// snapshot — as_of_seq is exactly the ledger state the balances derive from.
func (r *ReadRepository) GetBalances(ctx context.Context, groupID uuid.UUID) (entry.BalanceSnapshot, error) {
	rows, err := r.queries(ctx).GetGroupBalances(ctx, groupID)
	if err != nil {
		return entry.BalanceSnapshot{}, err
	}

	snap := entry.BalanceSnapshot{Balances: []entry.MemberBalance{}}
	for _, row := range rows {
		snap.Balances = append(snap.Balances, entry.MemberBalance{MemberID: row.MemberID, Balance: row.Balance})
		snap.AsOfSeq = row.AsOfSeq
	}
	return snap, nil
}

var _ entry.PairwiseReader = (*ReadRepository)(nil)

// GetPairwiseBalances derives per-pair "who owes whom" from entries and
// postings in one statement (one MVCC snapshot) — see the GetPairwiseBalances
// sqlc query for the contribution rule.
func (r *ReadRepository) GetPairwiseBalances(ctx context.Context, groupID uuid.UUID) ([]entry.PairwiseBalance, error) {
	rows, err := r.queries(ctx).GetPairwiseBalances(ctx, groupID)
	if err != nil {
		return nil, err
	}
	pairs := make([]entry.PairwiseBalance, len(rows))
	for i, row := range rows {
		pairs[i] = entry.PairwiseBalance{A: row.A, B: row.B, Amount: row.Amount}
	}
	return pairs, nil
}

var _ entry.HistoryReader = (*ReadRepository)(nil)

const (
	defaultListLimit = 100
	maxListLimit     = 500
)

// ListEntries pages the ledger in seq order. No transaction needed: visible
// entries and postings are immutable (append-only), so two queries cannot
// disagree about rows they both see.
func (r *ReadRepository) ListEntries(ctx context.Context, groupID uuid.UUID, afterSeq int64, limit int) ([]entry.Record, error) {
	if limit < 1 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}

	q := r.queries(ctx)
	rows, err := q.ListEntriesAfterSeq(ctx, sqlc.ListEntriesAfterSeqParams{
		GroupID: groupID, Seq: &afterSeq,
		Limit: int32(limit), //nolint:gosec // clamped to maxListLimit (500) above; cannot overflow int32
	})
	if err != nil {
		return nil, err
	}

	entries := make([]entry.Record, 0, len(rows))
	index := map[uuid.UUID]int{}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		e := entry.Record{
			ID:           row.ID,
			Seq:          *row.Seq,
			Kind:         entry.Kind(row.Kind),
			ReversesID:   row.ReversesID,
			PayerID:      row.PayerID,
			Counterparty: row.Counterparty,
			TotalAmount:  row.TotalAmount,
			SplitRule:    row.SplitRule,
			Participants: row.Participants,
			Memo:         row.Memo,
			OccurredOn:   row.OccurredOn.Time.Format("2006-01-02"),
			CreatedBy:    row.CreatedBy,
			CreatedAt:    row.CreatedAt.Time,
			Postings:     []ledger.Posting{},
		}
		index[e.ID] = len(entries)
		ids = append(ids, e.ID)
		entries = append(entries, e)
	}
	if len(ids) == 0 {
		return entries, nil
	}

	postings, err := q.ListPostingsForEntries(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, p := range postings {
		i := index[p.EntryID]
		entries[i].Postings = append(entries[i].Postings, ledger.Posting{MemberID: p.MemberID, Amount: p.Amount})
	}
	return entries, nil
}
