package postgres

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func seedMember(t *testing.T, s *Store, id uuid.UUID, name string) {
	t.Helper()
	if _, err := s.Pool.Exec(context.Background(),
		`INSERT INTO members (id, name) VALUES ($1, $2)`, id, name); err != nil {
		t.Fatalf("seed member: %v", err)
	}
}

func seedGroupWithMembers(t *testing.T, s *Store, groupID uuid.UUID, memberIDs ...uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, `INSERT INTO groups (id, name) VALUES ($1, 'g')`, groupID); err != nil {
		t.Fatalf("seed group: %v", err)
	}
	for _, m := range memberIDs {
		if _, err := s.Pool.Exec(ctx,
			`INSERT INTO group_members (group_id, member_id) VALUES ($1, $2)`, groupID, m); err != nil {
			t.Fatalf("seed group_member: %v", err)
		}
	}
}

func memberExists(t *testing.T, s *Store, id uuid.UUID) bool {
	t.Helper()
	var n int
	if err := s.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM members WHERE id = $1`, id).Scan(&n); err != nil {
		t.Fatalf("memberExists: %v", err)
	}
	return n > 0
}

func TestMembershipRepository_AllMembers(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()
	repo := NewMembershipRepository(s.Pool)

	gid := uuid.New()
	m1, m2, outsider := uuid.New(), uuid.New(), uuid.New()
	seedMember(t, s, m1, "m1")
	seedMember(t, s, m2, "m2")
	seedMember(t, s, outsider, "outsider")
	seedGroupWithMembers(t, s, gid, m1, m2)

	cases := []struct {
		name string
		ids  []uuid.UUID
		want bool
	}{
		{"all in group", []uuid.UUID{m1, m2}, true},
		{"one outsider", []uuid.UUID{m1, outsider}, false},
		{"duplicates of valid members", []uuid.UUID{m1, m1, m2}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := repo.AllMembers(ctx, gid, tc.ids)
			if err != nil {
				t.Fatalf("AllMembers: %v", err)
			}
			if got != tc.want {
				t.Fatalf("AllMembers(%v) = %v, want %v", tc.ids, got, tc.want)
			}
		})
	}
}
