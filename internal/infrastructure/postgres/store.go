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
	// The idempotency gate is a repository; embedding it promotes Acquire,
	// Release, and SweepStalePending onto Store so its callers keep their
	// method surface while the gate runs on generated queries.
	*IdempotencyRepository
	// Embedding EntryRepository promotes Create, Reverse, and Edit onto Store
	// the same way, so entry.Repository/Reverser/Editor stay satisfied without
	// callers threading a separate repository through.
	*EntryRepository
	// Embedding ReadRepository promotes GetBalances and ListEntries onto
	// Store, satisfying entry.BalanceReader/HistoryReader.
	*ReadRepository
	// Embedding IntegrityRepository promotes CheckIntegrity onto Store.
	*IntegrityRepository
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
		Pool:                  pool,
		IdempotencyRepository: NewIdempotencyRepository(pool),
		EntryRepository:       NewEntryRepository(pool),
		ReadRepository:        NewReadRepository(pool),
		IntegrityRepository:   NewIntegrityRepository(pool),
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
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}

// dbURLDecision is what TestStore should do for a given environment.
type dbURLDecision int

const (
	dbProceed dbURLDecision = iota // URL present — connect and run
	dbSkip                         // no URL, not CI — skip, so local `go test` works without Docker
	dbFail                         // no URL but in CI — fail, because a skipped suite is a false green
)

// decideDBURL reports what TestStore should do, given the raw values of
// TEST_DATABASE_URL and CI.
//
// Locally, a missing URL skips: `go test ./...` stays usable without Docker
// running. Under CI it must fail instead — a workflow that forgets to wire the
// database would otherwise skip every DB-backed test and still report green,
// which is the exact failure mode this guard exists to prevent.
//
// "false" and "0" are honoured rather than treated as merely non-empty: the
// JS ecosystem trained people to `export CI=false` as a workaround, and this
// repo ships a web/ directory, so a contributor plausibly has it set. Reading
// that as "in CI" would turn their DB-less `go test` into a hard failure.
func decideDBURL(url, ci string) dbURLDecision {
	if url != "" {
		return dbProceed
	}
	if ci != "" && ci != "false" && ci != "0" {
		return dbFail
	}
	return dbSkip
}

// TestStore returns a migrated store against TEST_DATABASE_URL with all tables
// truncated. Without the env var it skips locally and fails under CI — see
// decideDBURL.
func TestStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	switch decideDBURL(url, os.Getenv("CI")) {
	case dbFail:
		t.Fatal("TEST_DATABASE_URL unset in CI: integration tests must not skip")
	case dbSkip:
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
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
