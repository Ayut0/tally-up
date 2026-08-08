package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"tallyup/internal/domain/group"
	"tallyup/internal/infrastructure/postgres/sqlc"
)

var (
	_ group.Repository = (*GroupRepository)(nil)
	_ group.Reader     = (*GroupRepository)(nil)
)

// GroupRepository persists groups and their members, and reads them back, on
// the sqlc + repository stack — same shape as EntryRepository.
type GroupRepository struct {
	*BaseRepository
	tx *Transaction
}

func NewGroupRepository(pool *pgxpool.Pool) *GroupRepository {
	return &GroupRepository{BaseRepository: NewBaseRepository(pool), tx: NewTransaction(pool)}
}

// CreateGroup runs the write path's single transaction: group insert, one
// member insert + group_member link per member name, and marking the
// idempotency key succeeded with the response snapshot.
func (r *GroupRepository) CreateGroup(ctx context.Context, key uuid.UUID, in group.Input) ([]byte, error) {
	var resp []byte
	err := r.tx.Do(ctx, func(ctx context.Context) error {
		q := r.queries(ctx)

		if err := q.InsertGroup(ctx, sqlc.InsertGroupParams{ID: in.ID, Name: in.Name}); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
				return group.ErrDuplicateID
			}
			return err
		}

		members := make([]group.Member, len(in.MemberNames))
		for i, name := range in.MemberNames {
			// Members have no DB-generated default id, unlike a group or entry.
			memberID, err := uuid.NewV7()
			if err != nil {
				return err
			}
			if err := q.InsertMember(ctx, sqlc.InsertMemberParams{ID: memberID, Name: name}); err != nil {
				return err
			}
			if err := q.InsertGroupMember(ctx, sqlc.InsertGroupMemberParams{GroupID: in.ID, MemberID: memberID}); err != nil {
				return err
			}
			members[i] = group.Member{ID: memberID, Name: name}
		}

		snapshot, err := json.Marshal(group.Record{ID: in.ID, Name: in.Name, Members: members})
		if err != nil {
			return err
		}

		// RETURNING gives us the JSONB-normalized bytes, so this first response is
		// byte-identical to every future replay read from the same column.
		resp, err = q.MarkIdempotencySucceeded(ctx, sqlc.MarkIdempotencySucceededParams{
			Key: key, ResponseBody: snapshot,
		})
		return err
	})
	return resp, err
}

var _ group.MemberAdder = (*GroupRepository)(nil)

// AddMember runs the write path's single transaction: one member insert plus
// its group_members link, and marking the idempotency key succeeded with the
// response snapshot — same shape as CreateGroup, minting one member id
// instead of N.
func (r *GroupRepository) AddMember(ctx context.Context, key uuid.UUID, groupID uuid.UUID, name string) ([]byte, error) {
	var resp []byte
	err := r.tx.Do(ctx, func(ctx context.Context) error {
		q := r.queries(ctx)

		// Members have no DB-generated default id, unlike a group or entry.
		memberID, err := uuid.NewV7()
		if err != nil {
			return err
		}
		if err := q.InsertMember(ctx, sqlc.InsertMemberParams{ID: memberID, Name: name}); err != nil {
			return err
		}
		if err := q.InsertGroupMember(ctx, sqlc.InsertGroupMemberParams{GroupID: groupID, MemberID: memberID}); err != nil {
			return err
		}

		snapshot, err := json.Marshal(group.Member{ID: memberID, Name: name})
		if err != nil {
			return err
		}

		// RETURNING gives us the JSONB-normalized bytes, so this first response is
		// byte-identical to every future replay read from the same column.
		resp, err = q.MarkIdempotencySucceeded(ctx, sqlc.MarkIdempotencySucceededParams{
			Key: key, ResponseBody: snapshot,
		})
		return err
	})
	return resp, err
}

// GetGroup fetches a group and its members. No transaction needed: a group's
// membership only ever grows via CreateGroup's single atomic insert, so two
// reads here cannot observe a group without any members it should have.
func (r *GroupRepository) GetGroup(ctx context.Context, id uuid.UUID) (group.Record, error) {
	q := r.queries(ctx)

	g, err := q.SelectGroup(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return group.Record{}, group.ErrNotFound
	}
	if err != nil {
		return group.Record{}, err
	}

	rows, err := q.SelectGroupMembers(ctx, id)
	if err != nil {
		return group.Record{}, err
	}
	members := make([]group.Member, len(rows))
	for i, row := range rows {
		members[i] = group.Member{ID: row.ID, Name: row.Name}
	}

	return group.Record{ID: g.ID, Name: g.Name, Members: members}, nil
}
