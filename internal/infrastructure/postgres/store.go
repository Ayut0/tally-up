// Package postgres implements tally-up's domain repository and port
// interfaces against Postgres. It owns all pgx access, schema migrations,
// and the idempotency gate; nothing outside this package knows Postgres
// exists.
package postgres

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"log/slog"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Store owns the connection pool and schema migrations only — it holds no
// query methods of its own and satisfies no domain repository interface.
// Callers reach the actual repositories by name (Idempotency, Entries,
// Reads, Integrity); see docs/adr/0002-sqlc-adoption.md.
type Store struct {
	Pool *pgxpool.Pool

	Idempotency *IdempotencyRepository
	Entries     *EntryRepository
	Groups      *GroupRepository
	Reads       *ReadRepository
	Integrity   *IntegrityRepository
}

// New connects, runs pending migrations, and returns the store.
func New(ctx context.Context, databaseURL string) (*Store, error) {
	if err := Migrate(databaseURL); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &Store{
		Pool:        pool,
		Idempotency: NewIdempotencyRepository(pool),
		Entries:     NewEntryRepository(pool),
		Groups:      NewGroupRepository(pool),
		Reads:       NewReadRepository(pool),
		Integrity:   NewIntegrityRepository(pool),
	}, nil
}

func Migrate(databaseURL string) error {
	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return err
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, databaseURL)
	if err != nil {
		return err
	}
	defer func() {
		if srcErr, dbErr := m.Close(); srcErr != nil || dbErr != nil {
			slog.Warn("migrate close", "source_err", srcErr, "db_err", dbErr)
		}
	}()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}
