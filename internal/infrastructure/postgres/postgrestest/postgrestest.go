// Package postgrestest builds an isolated *postgres.Store for tests: a
// migrated connection against TEST_DATABASE_URL with every table truncated.
// It exists so postgres itself ships no test-support code — see
// docs/adr/0002-sqlc-adoption.md and tasks/lessons.md's 2026-07-25 entry.
package postgrestest

import (
	"context"
	"os"
	"testing"

	"tallyup/internal/infrastructure/postgres"
)

// dbURLDecision is what Store should do for a given environment.
type dbURLDecision int

const (
	dbProceed dbURLDecision = iota // URL present — connect and run
	dbSkip                         // no URL, none demanded — skip, so `go test` works without Docker
	dbFail                         // no URL but one was demanded — fail, because skipping would be a false green
)

// requireDBEnv, when set to anything but "false" or "0", turns a missing
// TEST_DATABASE_URL from a skip into a failure.
const requireDBEnv = "TALLYUP_REQUIRE_DB"

// decideDBURL reports what Store should do, given the raw values of
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

// Store returns a migrated *postgres.Store against TEST_DATABASE_URL with all
// tables truncated. Without the env var it skips, unless TALLYUP_REQUIRE_DB
// demands otherwise — see decideDBURL.
func Store(t *testing.T) *postgres.Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	switch decideDBURL(url, os.Getenv(requireDBEnv)) {
	case dbFail:
		t.Fatalf("TEST_DATABASE_URL unset while %s is set: DB-backed tests must not skip here", requireDBEnv)
	case dbSkip:
		t.Skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
	case dbProceed: // URL present — nothing to do, proceed to connect below
	}
	s, err := postgres.New(context.Background(), url)
	if err != nil {
		t.Fatalf("postgrestest.Store: %v", err)
	}
	t.Cleanup(s.Pool.Close)
	_, err = s.Pool.Exec(context.Background(),
		`TRUNCATE postings, entries, group_members, groups, members, idempotency_keys CASCADE`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return s
}
