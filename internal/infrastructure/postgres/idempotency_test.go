package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
)

func TestGate_FreshKeyProceeds(t *testing.T) {
	s := TestStore(t)
	res, _, err := s.Acquire(context.Background(), uuid.New(), "hash1")
	if err != nil {
		t.Fatal(err)
	}
	if res != entry.GateProceed {
		t.Fatalf("got %v, want GateProceed", res)
	}
}

func TestGate_DuplicatePendingIsInFlight(t *testing.T) {
	s := TestStore(t)
	key := uuid.New()
	ctx := context.Background()
	s.Acquire(ctx, key, "hash1")
	res, _, err := s.Acquire(ctx, key, "hash1")
	if err != nil {
		t.Fatal(err)
	}
	if res != entry.GateInFlight {
		t.Fatalf("got %v, want GateInFlight", res)
	}
}

func TestGate_SucceededKeyReplaysStoredResponse(t *testing.T) {
	s := TestStore(t)
	key := uuid.New()
	ctx := context.Background()
	s.Acquire(ctx, key, "hash1")
	_, err := s.Pool.Exec(ctx,
		`UPDATE idempotency_keys SET status='succeeded', response_body='{"id":"x","seq":1}' WHERE key=$1`, key)
	if err != nil {
		t.Fatal(err)
	}
	res, body, err := s.Acquire(ctx, key, "hash1")
	if err != nil {
		t.Fatal(err)
	}
	if res != entry.GateReplay {
		t.Fatalf("got %v, want GateReplay", res)
	}
	if string(body) != `{"id": "x", "seq": 1}` && string(body) != `{"id":"x","seq":1}` {
		t.Fatalf("unexpected replay body: %s", body)
	}
}

func TestGate_HashMismatchRejected(t *testing.T) {
	s := TestStore(t)
	key := uuid.New()
	ctx := context.Background()
	s.Acquire(ctx, key, "hash1")
	res, _, err := s.Acquire(ctx, key, "DIFFERENT")
	if err != nil {
		t.Fatal(err)
	}
	if res != entry.GateMismatch {
		t.Fatalf("got %v, want GateMismatch", res)
	}
}

func TestSweepStalePending(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()
	stale, fresh := uuid.New(), uuid.New()
	s.Acquire(ctx, stale, "h")
	s.Acquire(ctx, fresh, "h")
	_, err := s.Pool.Exec(ctx,
		`UPDATE idempotency_keys SET created_at = now() - interval '10 minutes' WHERE key=$1`, stale)
	if err != nil {
		t.Fatal(err)
	}
	n, err := s.SweepStalePending(ctx, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("swept %d rows, want 1", n)
	}
	// The stale key can now be re-acquired; the fresh one is still in flight.
	if res, _, _ := s.Acquire(ctx, stale, "h"); res != entry.GateProceed {
		t.Fatalf("stale key after sweep: got %v, want GateProceed", res)
	}
	if res, _, _ := s.Acquire(ctx, fresh, "h"); res != entry.GateInFlight {
		t.Fatalf("fresh key after sweep: got %v, want GateInFlight", res)
	}
}

func TestReleaseIdempotencyKey_PendingOnly(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()

	// A released pending key can be re-acquired immediately.
	key := uuid.New()
	s.Acquire(ctx, key, "h")
	if err := s.Release(ctx, key); err != nil {
		t.Fatal(err)
	}
	if res, _, _ := s.Acquire(ctx, key, "h"); res != entry.GateProceed {
		t.Fatalf("after release: got %v, want GateProceed", res)
	}

	// A succeeded key must never be released — the response snapshot is truth.
	done := uuid.New()
	s.Acquire(ctx, done, "h")
	if _, err := s.Pool.Exec(ctx,
		`UPDATE idempotency_keys SET status='succeeded', response_body='{}' WHERE key=$1`, done); err != nil {
		t.Fatal(err)
	}
	if err := s.Release(ctx, done); err != nil {
		t.Fatal(err)
	}
	if res, _, _ := s.Acquire(ctx, done, "h"); res != entry.GateReplay {
		t.Fatalf("succeeded key survived release: got %v, want GateReplay", res)
	}
}
