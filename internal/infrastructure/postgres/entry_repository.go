package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/group"
	"tallyup/internal/domain/ledger"
	"tallyup/internal/infrastructure/postgres/sqlc"
)

var _ entry.Repository = (*EntryRepository)(nil)

// EntryRepository persists entries and their postings on the sqlc +
// repository stack, running the write path's single transaction through
// Transaction.Do (see BaseRepository) so its queries behave the same inside
// and outside a transaction.
type EntryRepository struct {
	*BaseRepository
	tx *Transaction
}

func NewEntryRepository(pool *pgxpool.Pool) *EntryRepository {
	return &EntryRepository{BaseRepository: NewBaseRepository(pool), tx: NewTransaction(pool)}
}

// Create runs the write path's single transaction: membership check, entry +
// postings insert, and marking the idempotency key succeeded with the
// response snapshot. postings must already sum to zero (asserted here too).
func (r *EntryRepository) Create(ctx context.Context, key uuid.UUID, in entry.Input, postings []ledger.Posting) ([]byte, error) {
	if err := assertZeroSum(postings); err != nil {
		return nil, err
	}

	var resp []byte
	err := r.tx.Do(ctx, func(ctx context.Context) error {
		q := r.queries(ctx)

		seq, err := insertEntryAndPostings(ctx, q, in, postings)
		if err != nil {
			return err
		}

		// RETURNING gives us the JSONB-normalized bytes, so this first response is
		// byte-identical to every future replay read from the same column.
		snapshot := fmt.Appendf(nil, `{"id":%q,"seq":%d}`, in.ID, seq)
		resp, err = q.MarkIdempotencySucceeded(ctx, sqlc.MarkIdempotencySucceededParams{
			Key: key, ResponseBody: snapshot,
		})
		return err
	})
	return resp, err
}

// insertEntryAndPostings validates group membership, appends one entry, and
// appends its postings — the shared core of Create (above) and Edit's
// replacement half (reversals.go). Caller owns the transaction and has
// already zero-sum-checked postings.
func insertEntryAndPostings(ctx context.Context, q *sqlc.Queries, in entry.Input, postings []ledger.Posting) (int64, error) {
	// Everyone touched by this entry must belong to the group.
	ids := dedup(touchedMembers(in))
	cnt, err := q.CountGroupMembers(ctx, sqlc.CountGroupMembersParams{
		GroupID: in.GroupID, MemberIds: ids,
	})
	if err != nil {
		return 0, err
	}
	if int(cnt) != len(ids) {
		return 0, group.ErrNotMember
	}

	seq, err := q.InsertEntry(ctx, sqlc.InsertEntryParams{
		ID: in.ID, GroupID: in.GroupID, Kind: string(in.Kind), PayerID: in.PayerID,
		Counterparty: in.Counterparty, TotalAmount: in.TotalAmount, SplitRule: in.SplitRule,
		Participants: in.Participants, Memo: &in.Memo,
		OccurredOn: pgtype.Date{Time: in.OccurredOn, Valid: true}, CreatedBy: in.CreatedBy,
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
		return 0, entry.ErrDuplicateID
	}
	if err != nil {
		return 0, err
	}

	for _, p := range postings {
		if err := q.InsertPosting(ctx, sqlc.InsertPostingParams{
			EntryID: in.ID, MemberID: p.MemberID, Amount: p.Amount,
		}); err != nil {
			return 0, err
		}
	}

	return *seq, nil
}

// touchedMembers returns payer, recorder, participants, and the optional
// counterparty as one slice — everyone the entry's membership check must
// cover. CreatedBy is independent of payer_id and participants (b can record
// a's expense), so it needs its own membership check rather than riding
// along on theirs.
func touchedMembers(in entry.Input) []uuid.UUID {
	touched := append([]uuid.UUID{in.PayerID, in.CreatedBy}, in.Participants...)
	if in.Counterparty != nil {
		touched = append(touched, *in.Counterparty)
	}
	return touched
}

// assertZeroSum is shared with Edit (reversals.go), whose replacement entry
// still runs through insertEntryAndPostings above.
func assertZeroSum(postings []ledger.Posting) error {
	var sum int64
	for _, p := range postings {
		sum += p.Amount
	}
	if sum != 0 {
		return fmt.Errorf("postings sum to %d, refusing to write", sum)
	}
	return nil
}
