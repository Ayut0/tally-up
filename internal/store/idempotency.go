package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type GateResult int

const (
	GateProceed  GateResult = iota // this request owns the operation
	GateReplay                     // already succeeded; return stored body
	GateInFlight                   // another request holds a pending row
	GateMismatch                   // same key, different payload — client bug
)

// AcquireIdempotencyKey implements the pending-row-first gate from
// architecture.md §4. The pending insert commits immediately (its own
// implicit txn) so a crash leaves a visible pending row for the janitor.
func (s *Store) AcquireIdempotencyKey(ctx context.Context, key uuid.UUID, requestHash string) (GateResult, []byte, error) {
	ct, err := s.Pool.Exec(ctx,
		`INSERT INTO idempotency_keys (key, request_hash, status) VALUES ($1, $2, 'pending')
		 ON CONFLICT (key) DO NOTHING`, key, requestHash)
	if err != nil {
		return 0, nil, err
	}
	if ct.RowsAffected() == 1 {
		return GateProceed, nil, nil
	}

	var storedHash, status string
	var body []byte
	err = s.Pool.QueryRow(ctx,
		`SELECT request_hash, status, COALESCE(response_body, 'null'::jsonb)
		 FROM idempotency_keys WHERE key = $1`, key).Scan(&storedHash, &status, &body)
	if errors.Is(err, pgx.ErrNoRows) {
		// Janitor deleted the row between our insert-conflict and this read;
		// tell the client to retry rather than racing to re-own it here.
		return GateInFlight, nil, nil
	}
	if err != nil {
		return 0, nil, err
	}
	if storedHash != requestHash {
		return GateMismatch, nil, nil
	}
	if status == "succeeded" {
		return GateReplay, body, nil
	}
	return GateInFlight, nil, nil
}

// ReleaseIdempotencyKey frees a pending key after a post-gate failure so the
// client can retry immediately instead of waiting for the janitor. Succeeded
// keys are never released: their response snapshot is the replay truth.
func (s *Store) ReleaseIdempotencyKey(ctx context.Context, key uuid.UUID) error {
	_, err := s.Pool.Exec(ctx,
		`DELETE FROM idempotency_keys WHERE key = $1 AND status = 'pending'`, key)
	return err
}

// SweepStalePending deletes pending rows older than olderThan so crashed
// requests can be retried cleanly.
func (s *Store) SweepStalePending(ctx context.Context, olderThan time.Duration) (int64, error) {
	ct, err := s.Pool.Exec(ctx,
		`DELETE FROM idempotency_keys
		 WHERE status = 'pending' AND created_at < now() - make_interval(secs => $1)`,
		olderThan.Seconds())
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}
