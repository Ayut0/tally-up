package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"tallyup/internal/infrastructure/postgres/sqlc"
)

// txKey is the private context key under which an in-flight transaction is
// carried, so repository methods can find it without the caller threading a
// *pgx.Tx through their signatures.
type txKey struct{}

// Transaction runs a group of repository operations inside one database
// transaction. It commits when the function returns nil and rolls back on any
// error, so multi-step writes stay atomic without each repository knowing about
// transaction boundaries.
type Transaction struct {
	pool *pgxpool.Pool
}

func NewTransaction(pool *pgxpool.Pool) *Transaction {
	return &Transaction{pool: pool}
}

// Do begins a transaction, binds it to the context it passes to fn, and
// commits or rolls back based on fn's result. Any repository that resolves its
// queries through sessionOr will run against this transaction.
func (t *Transaction) Do(ctx context.Context, fn func(ctx context.Context) error) error {
	tx, err := t.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) // no-op once Commit succeeds; the safety net on any early return

	if err := fn(withSession(ctx, tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// withSession returns a context carrying tx as the active database session.
func withSession(ctx context.Context, tx pgx.Tx) context.Context {
	return context.WithValue(ctx, txKey{}, tx)
}

// sessionOr returns the transaction bound to ctx when one is present, and
// fallback (normally the pool) otherwise. Both pgx.Tx and *pgxpool.Pool satisfy
// sqlc.DBTX, so callers get the same query API either way.
func sessionOr(ctx context.Context, fallback sqlc.DBTX) sqlc.DBTX {
	if tx, ok := ctx.Value(txKey{}).(pgx.Tx); ok {
		return tx
	}
	return fallback
}
