package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/group"
)

// acquireKey claims key with a pending idempotency row, mirroring what
// creategroup.Service does before calling group.Repository.CreateGroup — the
// repository's CreateGroup only marks an existing pending row succeeded, it
// does not create one.
func acquireKey(t *testing.T, s *Store, key uuid.UUID) {
	t.Helper()
	res, _, err := s.Idempotency.Acquire(context.Background(), key, key.String())
	if err != nil || res != entry.GateProceed {
		t.Fatalf("acquire key: res=%v err=%v", res, err)
	}
}

func TestGroupRepository_CreateAndGet(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()
	repo := NewGroupRepository(s.Pool)

	groupID, key := uuid.New(), uuid.New()
	acquireKey(t, s, key)
	in := group.Input{ID: groupID, Name: "trip", MemberNames: []string{"yuto", "a", "b"}}
	if _, err := repo.CreateGroup(ctx, key, in); err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}

	rec, err := repo.GetGroup(ctx, groupID)
	if err != nil {
		t.Fatalf("GetGroup: %v", err)
	}
	if rec.ID != groupID || rec.Name != "trip" {
		t.Fatalf("GetGroup = %+v, want id=%s name=trip", rec, groupID)
	}
	if len(rec.Members) != 3 {
		t.Fatalf("got %d members, want 3", len(rec.Members))
	}
	seen := map[string]bool{}
	for _, m := range rec.Members {
		if m.ID == uuid.Nil {
			t.Fatalf("member %+v has nil id, want server-generated", m)
		}
		seen[m.Name] = true
	}
	for _, name := range []string{"yuto", "a", "b"} {
		if !seen[name] {
			t.Fatalf("member %q missing from %+v", name, rec.Members)
		}
	}
}

func TestGroupRepository_GetGroup_NotFound(t *testing.T) {
	s := TestStore(t)
	repo := NewGroupRepository(s.Pool)

	_, err := repo.GetGroup(context.Background(), uuid.New())
	if !errors.Is(err, group.ErrNotFound) {
		t.Fatalf("GetGroup(random id) err = %v, want group.ErrNotFound", err)
	}
}

func TestGroupRepository_CreateGroup_DuplicateID(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()
	repo := NewGroupRepository(s.Pool)

	groupID := uuid.New()
	in := group.Input{ID: groupID, Name: "trip", MemberNames: []string{"yuto"}}
	key1 := uuid.New()
	acquireKey(t, s, key1)
	if _, err := repo.CreateGroup(ctx, key1, in); err != nil {
		t.Fatalf("first CreateGroup: %v", err)
	}

	key2 := uuid.New()
	acquireKey(t, s, key2)
	_, err := repo.CreateGroup(ctx, key2, in)
	if !errors.Is(err, group.ErrDuplicateID) {
		t.Fatalf("second CreateGroup err = %v, want group.ErrDuplicateID", err)
	}
}

func TestGroupRepository_AddMember(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()
	repo := NewGroupRepository(s.Pool)

	groupID, createKey := uuid.New(), uuid.New()
	acquireKey(t, s, createKey)
	if _, err := repo.CreateGroup(ctx, createKey, group.Input{ID: groupID, Name: "trip", MemberNames: []string{"yuto"}}); err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}

	addKey := uuid.New()
	acquireKey(t, s, addKey)
	resp, err := repo.AddMember(ctx, addKey, groupID, "new friend")
	if err != nil {
		t.Fatalf("AddMember: %v", err)
	}
	var added group.Member
	if err := json.Unmarshal(resp, &added); err != nil {
		t.Fatalf("response %s: %v", resp, err)
	}
	if added.Name != "new friend" || added.ID == uuid.Nil {
		t.Fatalf("bad AddMember response: %+v", added)
	}

	rec, err := repo.GetGroup(ctx, groupID)
	if err != nil {
		t.Fatalf("GetGroup: %v", err)
	}
	found := false
	for _, m := range rec.Members {
		if m.ID == added.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("new member not in group: %+v", rec.Members)
	}
}

// TestGroupRepository_AddMember_UsableAsParticipant exercises EntryRepository.Create
// with the newly added member as a participant, proving group-membership
// validation sees them immediately.
func TestGroupRepository_AddMember_UsableAsParticipant(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	repo := NewGroupRepository(s.Pool)

	key := uuid.New()
	acquireKey(t, s, key)
	resp, err := repo.AddMember(context.Background(), key, rGroup, "new friend")
	if err != nil {
		t.Fatalf("AddMember: %v", err)
	}
	var added group.Member
	if err := json.Unmarshal(resp, &added); err != nil {
		t.Fatalf("response %s: %v", resp, err)
	}

	addExactExpense(t, s, uuid.New(), rYuto, 1000, map[uuid.UUID]int64{rYuto: 500, added.ID: 500})
}
