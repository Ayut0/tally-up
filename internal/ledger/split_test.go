package ledger

import (
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// Fixed IDs whose byte order is yuto < memA < memB < memC.
var (
	yuto = uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	memA = uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	memB = uuid.MustParse("00000000-0000-0000-0000-00000000000c")
	memC = uuid.MustParse("00000000-0000-0000-0000-00000000000d")
)

func mustCompute(t *testing.T, payer uuid.UUID, total int64, rule SplitRule, parts []uuid.UUID) []Posting {
	t.Helper()
	got, err := ComputePostings(payer, total, rule, parts)
	if err != nil {
		t.Fatalf("ComputePostings: %v", err)
	}
	return got
}

func TestEqualSplit_PayerParticipates(t *testing.T) {
	// The worked example from architecture.md §3.
	got := mustCompute(t, yuto, 12000, SplitRule{Type: SplitEqual}, []uuid.UUID{yuto, memA, memB})
	want := []Posting{{yuto, 8000}, {memA, -4000}, {memB, -4000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestEqualSplit_PayerNotParticipant_RemainderTieGoesToSmallestID(t *testing.T) {
	// 10000/3 leaves 1 yen; all remainders tie, so smallest member ID (memA) pays it.
	got := mustCompute(t, yuto, 10000, SplitRule{Type: SplitEqual}, []uuid.UUID{memA, memB, memC})
	want := []Posting{{yuto, 10000}, {memA, -3334}, {memB, -3333}, {memC, -3333}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestEqualSplit_PayerSoleParticipant_NoPostings(t *testing.T) {
	got := mustCompute(t, yuto, 5000, SplitRule{Type: SplitEqual}, []uuid.UUID{yuto})
	if len(got) != 0 {
		t.Fatalf("expected no postings, got %v", got)
	}
}

func TestComputePostings_Validation(t *testing.T) {
	cases := []struct {
		name  string
		total int64
		parts []uuid.UUID
	}{
		{"zero total", 0, []uuid.UUID{memA}},
		{"negative total", -100, []uuid.UUID{memA}},
		{"over cap", MaxAmount + 1, []uuid.UUID{memA}},
		{"no participants", 1000, nil},
		{"duplicate participant", 1000, []uuid.UUID{memA, memA}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := ComputePostings(yuto, c.total, SplitRule{Type: SplitEqual}, c.parts); err == nil {
				t.Fatal("expected error, got nil")
			}
		})
	}
}
