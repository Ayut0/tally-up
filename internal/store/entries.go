package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"tallyup/internal/ledger"
)

var (
	ErrNotGroupMembers  = errors.New("payer, counterparty, and participants must all be group members")
	ErrDuplicateEntryID = errors.New("entry id already exists")
)

type EntryInput struct {
	ID           uuid.UUID
	GroupID      uuid.UUID
	Kind         string
	PayerID      uuid.UUID
	Counterparty *uuid.UUID
	TotalAmount  int64
	SplitRule    []byte // raw JSON, stored verbatim
	Participants []uuid.UUID
	Memo         string
	OccurredOn   time.Time
	CreatedBy    uuid.UUID
}

// CreateEntry runs the write path's single transaction: membership check,
// entry + postings insert, and marking the idempotency key succeeded with the
// response snapshot. postings must already sum to zero (asserted here too).
func (s *Store) CreateEntry(ctx context.Context, key uuid.UUID, in EntryInput, postings []ledger.Posting) ([]byte, error) {
	var sum int64
	for _, p := range postings {
		sum += p.Amount
	}
	if sum != 0 {
		return nil, fmt.Errorf("postings sum to %d, refusing to write", sum)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Everyone touched by this entry must belong to the group.
	touched := append([]uuid.UUID{in.PayerID}, in.Participants...)
	if in.Counterparty != nil {
		touched = append(touched, *in.Counterparty)
	}
	uniq := make(map[uuid.UUID]bool, len(touched))
	ids := touched[:0]
	for _, m := range touched {
		if !uniq[m] {
			uniq[m] = true
			ids = append(ids, m)
		}
	}
	var cnt int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM group_members WHERE group_id=$1 AND member_id = ANY($2)`,
		in.GroupID, ids).Scan(&cnt); err != nil {
		return nil, err
	}
	if cnt != len(ids) {
		return nil, ErrNotGroupMembers
	}

	var seq int64
	err = tx.QueryRow(ctx, `
		INSERT INTO entries (id, group_id, kind, payer_id, counterparty, total_amount,
		                     split_rule, participants, memo, occurred_on, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING seq`,
		in.ID, in.GroupID, in.Kind, in.PayerID, in.Counterparty, in.TotalAmount,
		in.SplitRule, in.Participants, in.Memo, in.OccurredOn, in.CreatedBy).Scan(&seq)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
		return nil, ErrDuplicateEntryID
	}
	if err != nil {
		return nil, err
	}

	for _, p := range postings {
		if _, err := tx.Exec(ctx,
			`INSERT INTO postings (entry_id, member_id, amount) VALUES ($1,$2,$3)`,
			in.ID, p.MemberID, p.Amount); err != nil {
			return nil, err
		}
	}

	// RETURNING gives us the JSONB-normalized bytes, so this first response is
	// byte-identical to every future replay read from the same column.
	snapshot := []byte(fmt.Sprintf(`{"id":%q,"seq":%d}`, in.ID, seq))
	var resp []byte
	if err := tx.QueryRow(ctx,
		`UPDATE idempotency_keys SET status='succeeded', response_body=$2 WHERE key=$1
		 RETURNING response_body`,
		key, snapshot).Scan(&resp); err != nil {
		return nil, err
	}
	return resp, tx.Commit(ctx)
}
