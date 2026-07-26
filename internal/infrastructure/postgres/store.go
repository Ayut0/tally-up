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
	"os"
	"testing"

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

// dbURLDecision is what TestStore should do for a given environment.
type dbURLDecision int

const (
	dbProceed dbURLDecision = iota // URL present — connect and run
	dbSkip                         // no URL, none demanded — skip, so `go test` works without Docker
	dbFail                         // no URL but one was demanded — fail, because skipping would be a false green
)

// requireDBEnv, when set to anything but "false" or "0", turns a missing
// TEST_DATABASE_URL from a skip into a failure.
const requireDBEnv = "TALLYUP_REQUIRE_DB"

// decideDBURL reports what TestStore should do, given the raw values of
// TEST_DATABASE_URL and TALLYUP_REQUIRE_DB.
//
// A missing URL skips by default, so `go test ./...` stays usable without
// Docker running. Where DB coverage is expected, setting TALLYUP_REQUIRE_DB
// makes the same condition fail instead — an environment that believes it is
// exercising the database, but silently isn't, reports green while asserting
// nothing.
//
// The opt-in is explicit rather than keyed off CI because CI does not run
// DB-backed tests yet. When it does, the workflow sets this var; until then a
// skip there is intended, not a defect.
//
// "false" and "0" are honoured rather than treated as merely non-empty, so the
// var can be turned off by value as well as by absence.
func decideDBURL(url, requireDB string) dbURLDecision {
	if url != "" {
		return dbProceed
	}
	if requireDB != "" && requireDB != "false" && requireDB != "0" {
		return dbFail
	}
	return dbSkip
}

// TestStore returns a migrated store against TEST_DATABASE_URL with all tables
// truncated. Without the env var it skips, unless TALLYUP_REQUIRE_DB demands
// otherwise — see decideDBURL.
func TestStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	switch decideDBURL(url, os.Getenv(requireDBEnv)) {
	case dbFail:
		t.Fatalf("TEST_DATABASE_URL unset while %s is set: DB-backed tests must not skip here", requireDBEnv)
	case dbSkip:
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	case dbProceed: // URL present — nothing to do, proceed to connect below
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
