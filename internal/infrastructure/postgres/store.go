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
	"os"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type Store struct {
	Pool *pgxpool.Pool
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
	return &Store{Pool: pool}, nil
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
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}

// TestStore returns a migrated store against TEST_DATABASE_URL with all
// tables truncated, or skips the test when the env var is unset.
func TestStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; run `docker compose up -d db` and export it")
	}
	s, err := New(context.Background(), url)
	if err != nil {
		t.Fatalf("TestStore: %v", err)
	}
	t.Cleanup(s.Pool.Close)
	_, err = s.Pool.Exec(context.Background(),
		`TRUNCATE postings, entries, group_members, groups, members, idempotency_keys CASCADE`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return s
}
