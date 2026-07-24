package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"tallyup/internal/infrastructure/postgres/sqlc"
)

// BaseRepository is embedded by every Postgres repository. It resolves sqlc
// queries against the transaction bound to the context when one is present (see
// Transaction.Do) and the connection pool otherwise, so a repository method
// behaves identically inside and outside a transaction.
type BaseRepository struct {
	pool *pgxpool.Pool
}

func NewBaseRepository(pool *pgxpool.Pool) *BaseRepository {
	return &BaseRepository{pool: pool}
}

// queries returns a sqlc query set bound to the active session for ctx.
func (r *BaseRepository) queries(ctx context.Context) *sqlc.Queries {
	return sqlc.New(sessionOr(ctx, r.pool))
}
