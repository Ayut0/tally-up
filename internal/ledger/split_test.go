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

func TestSharesSplit_HotelRooms(t *testing.T) {
	// 2:2:1 (couples vs. single), ¥30,000 → 12,000 / 12,000 / 6,000.
	rule := SplitRule{Type: SplitShares, Weights: map[uuid.UUID]int64{memA: 2, memB: 2, memC: 1}}
	got := mustCompute(t, memA, 30000, rule, []uuid.UUID{memA, memB, memC})
	want := []Posting{{memA, 18000}, {memB, -12000}, {memC, -6000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestSharesSplit_LargestRemainderFavorsBiggerRemainder(t *testing.T) {
	// ¥100 at 1:2 → bases 33+66=99; remainders 1 vs 2 → extra yen to the 2-share member.
	rule := SplitRule{Type: SplitShares, Weights: map[uuid.UUID]int64{memA: 1, memB: 2}}
	got := mustCompute(t, yuto, 100, rule, []uuid.UUID{memA, memB})
	want := []Posting{{yuto, 100}, {memA, -33}, {memB, -67}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestSharesSplit_WeightsMustCoverParticipants(t *testing.T) {
	rule := SplitRule{Type: SplitShares, Weights: map[uuid.UUID]int64{memA: 1}}
	if _, err := ComputePostings(yuto, 100, rule, []uuid.UUID{memA, memB}); err == nil {
		t.Fatal("expected error for missing weight")
	}
	rule = SplitRule{Type: SplitShares, Weights: map[uuid.UUID]int64{memA: 1, memB: 1, memC: 1}}
	if _, err := ComputePostings(yuto, 100, rule, []uuid.UUID{memA, memB}); err == nil {
		t.Fatal("expected error for extra weight")
	}
}

func TestPercentSplit(t *testing.T) {
	rule := SplitRule{Type: SplitPercent, Weights: map[uuid.UUID]int64{memA: 50, memB: 30, memC: 20}}
	got := mustCompute(t, memC, 10000, rule, []uuid.UUID{memA, memB, memC})
	want := []Posting{{memA, -5000}, {memB, -3000}, {memC, 8000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestPercentSplit_MustSumTo100(t *testing.T) {
	rule := SplitRule{Type: SplitPercent, Weights: map[uuid.UUID]int64{memA: 50, memB: 49}}
	if _, err := ComputePostings(yuto, 10000, rule, []uuid.UUID{memA, memB}); err == nil {
		t.Fatal("expected error for percents not summing to 100")
	}
}

func TestExactSplit(t *testing.T) {
	rule := SplitRule{Type: SplitExact, Amounts: map[uuid.UUID]int64{memA: 7000, memB: 5000}}
	got := mustCompute(t, yuto, 12000, rule, []uuid.UUID{memA, memB})
	want := []Posting{{yuto, 12000}, {memA, -7000}, {memB, -5000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExactSplit_ZeroAmountMemberOmitted(t *testing.T) {
	rule := SplitRule{Type: SplitExact, Amounts: map[uuid.UUID]int64{memA: 12000, memB: 0}}
	got := mustCompute(t, yuto, 12000, rule, []uuid.UUID{memA, memB})
	want := []Posting{{yuto, 12000}, {memA, -12000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestExactSplit_MustSumToTotal(t *testing.T) {
	rule := SplitRule{Type: SplitExact, Amounts: map[uuid.UUID]int64{memA: 7000, memB: 4999}}
	if _, err := ComputePostings(yuto, 12000, rule, []uuid.UUID{memA, memB}); err == nil {
		t.Fatal("expected error for amounts not summing to total")
	}
}

func TestSettlementPostings(t *testing.T) {
	got, err := SettlementPostings(memB, memA, 4000) // B pays A ¥4,000
	if err != nil {
		t.Fatalf("SettlementPostings: %v", err)
	}
	want := []Posting{{memA, -4000}, {memB, 4000}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestSettlementPostings_Validation(t *testing.T) {
	if _, err := SettlementPostings(memA, memA, 100); err == nil {
		t.Fatal("expected error for self-settlement")
	}
	if _, err := SettlementPostings(memA, memB, 0); err == nil {
		t.Fatal("expected error for zero amount")
	}
}
