package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestTransaction_CommitsOnSuccess(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()
	tx := NewTransaction(s.Pool)
	mid := uuid.New()

	err := tx.Do(ctx, func(ctx context.Context) error {
		_, err := sessionOr(ctx, s.Pool).Exec(ctx,
			`INSERT INTO members (id, name) VALUES ($1, $2)`, mid, "committed")
		return err
	})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if !memberExists(t, s, mid) {
		t.Fatal("member inserted in a committed transaction should exist")
	}
}

func TestTransaction_RollsBackOnError(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()
	tx := NewTransaction(s.Pool)
	mid := uuid.New()
	boom := errors.New("boom")

	err := tx.Do(ctx, func(ctx context.Context) error {
		if _, err := sessionOr(ctx, s.Pool).Exec(ctx,
			`INSERT INTO members (id, name) VALUES ($1, $2)`, mid, "rolled-back"); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("Do error = %v, want boom", err)
	}
	if memberExists(t, s, mid) {
		t.Fatal("member inserted in a rolled-back transaction should not exist")
	}
}
