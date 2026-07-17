package ledger

import (
	"bytes"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"pgregory.net/rapid"
)

// drawScenario generates a valid (payer, total, rule, participants) tuple
// covering all four split types.
func drawScenario(t *rapid.T) (uuid.UUID, int64, SplitRule, []uuid.UUID) {
	n := rapid.IntRange(1, 8).Draw(t, "n")
	participants := make([]uuid.UUID, n)
	seen := make(map[uuid.UUID]bool, n)
	for i := range participants {
		var id uuid.UUID
		copy(id[:], rapid.SliceOfN(rapid.Byte(), 16, 16).Draw(t, "id"))
		if seen[id] {
			t.Skip() // vanishingly rare collision
		}
		seen[id] = true
		participants[i] = id
	}
	// Payer is a participant half the time, an outsider otherwise.
	payer := participants[0]
	if rapid.Bool().Draw(t, "outsidePayer") {
		copy(payer[:], rapid.SliceOfN(rapid.Byte(), 16, 16).Draw(t, "payerID"))
	}
	total := rapid.Int64Range(1, 10_000_000).Draw(t, "total")

	var rule SplitRule
	switch rapid.IntRange(0, 3).Draw(t, "ruleType") {
	case 0:
		rule = SplitRule{Type: SplitEqual}
	case 1:
		w := make(map[uuid.UUID]int64, n)
		for _, p := range participants {
			w[p] = rapid.Int64Range(1, 20).Draw(t, "weight")
		}
		rule = SplitRule{Type: SplitShares, Weights: w}
	case 2:
		// Compose 100 into n positive parts via sorted cut points.
		if n > 100 {
			t.Skip()
		}
		w := composeInto(t, 100, participants, 1)
		rule = SplitRule{Type: SplitPercent, Weights: w}
	case 3:
		if total < int64(n) {
			t.Skip()
		}
		a := composeInto(t, total, participants, 0)
		rule = SplitRule{Type: SplitExact, Amounts: a}
	}
	return payer, total, rule, participants
}

// composeInto splits sum into len(members) parts, each >= min, summing exactly.
func composeInto(t *rapid.T, sum int64, members []uuid.UUID, min int64) map[uuid.UUID]int64 {
	n := int64(len(members))
	out := make(map[uuid.UUID]int64, n)
	remaining := sum - min*n
	for i, m := range members {
		if int64(i) == n-1 {
			out[m] = min + remaining
			break
		}
		take := rapid.Int64Range(0, remaining).Draw(t, "part")
		out[m] = min + take
		remaining -= take
	}
	return out
}

func TestProperty_ZeroSumAndCoverage(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		payer, total, rule, participants := drawScenario(t)
		postings, err := ComputePostings(payer, total, rule, participants)
		if err != nil {
			t.Fatalf("valid scenario rejected: %v", err)
		}
		var sum int64
		allowed := map[uuid.UUID]bool{payer: true}
		for _, p := range participants {
			allowed[p] = true
		}
		for _, p := range postings {
			sum += p.Amount
			if !allowed[p.MemberID] {
				t.Fatalf("posting for non-participant %s", p.MemberID)
			}
			if p.Amount == 0 {
				t.Fatalf("zero-amount posting for %s", p.MemberID)
			}
		}
		if sum != 0 {
			t.Fatalf("postings sum to %d, want 0", sum)
		}
	})
}

func TestProperty_Deterministic(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		payer, total, rule, participants := drawScenario(t)
		a, err := ComputePostings(payer, total, rule, participants)
		if err != nil {
			t.Fatalf("valid scenario rejected: %v", err)
		}
		b, _ := ComputePostings(payer, total, rule, participants)
		if !reflect.DeepEqual(a, b) {
			t.Fatalf("non-deterministic: %v vs %v", a, b)
		}
		for i := 1; i < len(a); i++ {
			if bytes.Compare(a[i-1].MemberID[:], a[i].MemberID[:]) >= 0 {
				t.Fatalf("postings not sorted by member id: %v", a)
			}
		}
	})
}
