package ledger

import (
	"reflect"
	"testing"

	"github.com/google/uuid"
	"pgregory.net/rapid"
)

// drawZeroSumBalances generates a zero-sum []Posting: n members, an even
// split of a total that composeInto (from property_test.go) distributes
// then re-centers into signed net positions.
func drawZeroSumBalances(t *rapid.T) []Posting {
	n := rapid.IntRange(2, 12).Draw(t, "n")
	members := make([]uuid.UUID, n)
	seen := make(map[uuid.UUID]bool, n)
	for i := range members {
		var id uuid.UUID
		copy(id[:], rapid.SliceOfN(rapid.Byte(), 16, 16).Draw(t, "id"))
		if seen[id] {
			t.Skip() // vanishingly rare collision
		}
		seen[id] = true
		members[i] = id
	}

	// Split members into creditors/debtors, draw a positive amount for each
	// creditor, then make the last debtor absorb whatever balances the rest
	// so the total is exactly zero. Guarantees at least one of each side
	// whenever n >= 2, and a mix of magnitudes to exercise ties/re-scans.
	split := rapid.IntRange(1, n-1).Draw(t, "split")
	balances := make([]Posting, n)
	var creditTotal int64
	for i := 0; i < split; i++ {
		amt := rapid.Int64Range(1, 10_000).Draw(t, "credit")
		balances[i] = Posting{MemberID: members[i], Amount: amt}
		creditTotal += amt
	}
	remaining := creditTotal
	for i := split; i < n; i++ {
		var amt int64
		if i == n-1 {
			amt = remaining
		} else {
			amt = rapid.Int64Range(0, remaining).Draw(t, "debit")
		}
		balances[i] = Posting{MemberID: members[i], Amount: -amt}
		remaining -= amt
	}
	return balances
}

func TestProperty_SettlePlan_ZeroesBalances(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		balances := drawZeroSumBalances(t)
		transfers, err := SettlePlan(balances)
		if err != nil {
			t.Fatalf("valid zero-sum balances rejected: %v", err)
		}

		// A transfer's From is the debtor (payer, in SettlementPostings terms):
		// paying moves their balance up toward zero. To is the creditor
		// (counterparty): receiving moves their balance down toward zero.
		net := make(map[uuid.UUID]int64, len(balances))
		for _, b := range balances {
			net[b.MemberID] = b.Amount
		}
		for _, tr := range transfers {
			net[tr.From] += tr.Amount
			net[tr.To] -= tr.Amount
		}
		for member, amt := range net {
			if amt != 0 {
				t.Fatalf("member %s left at %d after applying plan %v", member, amt, transfers)
			}
		}
	})
}

func TestProperty_SettlePlan_BoundedPositiveDeterministic(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		balances := drawZeroSumBalances(t)
		a, err := SettlePlan(balances)
		if err != nil {
			t.Fatalf("valid zero-sum balances rejected: %v", err)
		}

		nonzero := 0
		for _, b := range balances {
			if b.Amount != 0 {
				nonzero++
			}
		}
		if len(a) > nonzero-1 && nonzero > 0 {
			t.Fatalf("got %d transfers, want at most nonzero-1 = %d", len(a), nonzero-1)
		}
		for _, tr := range a {
			if tr.Amount <= 0 {
				t.Fatalf("non-positive transfer amount: %+v", tr)
			}
		}

		b, err := SettlePlan(balances)
		if err != nil {
			t.Fatalf("second call rejected: %v", err)
		}
		if !reflect.DeepEqual(a, b) {
			t.Fatalf("non-deterministic: %v vs %v", a, b)
		}
	})
}

func TestSettlePlan_RejectsNonZeroSum(t *testing.T) {
	_, err := SettlePlan([]Posting{
		{MemberID: uuid.New(), Amount: 100},
		{MemberID: uuid.New(), Amount: -50},
	})
	if err == nil {
		t.Fatal("expected error for non-zero-sum balances")
	}
}

func TestSettlePlan_EmptyOrAllZero(t *testing.T) {
	for _, balances := range [][]Posting{
		nil,
		{},
		{{MemberID: uuid.New(), Amount: 0}, {MemberID: uuid.New(), Amount: 0}},
	} {
		transfers, err := SettlePlan(balances)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if transfers == nil {
			t.Fatal("expected non-nil empty slice, got nil")
		}
		if len(transfers) != 0 {
			t.Fatalf("expected no transfers, got %v", transfers)
		}
	}
}

func TestSettlePlan_TwoParty(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	transfers, err := SettlePlan([]Posting{
		{MemberID: a, Amount: 100},
		{MemberID: b, Amount: -100},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []Transfer{{From: b, To: a, Amount: 100}}
	if !reflect.DeepEqual(transfers, want) {
		t.Fatalf("got %v, want %v", transfers, want)
	}
}
