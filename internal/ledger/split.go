package ledger

import (
	"bytes"
	"fmt"
	"sort"

	"github.com/google/uuid"
)

const maxWeight = int64(1_000_000)

// ComputePostings expands one expense into signed postings that sum to zero.
// The payer need not be a participant; members with zero net are omitted.
// Output is sorted by member UUID bytes ascending.
func ComputePostings(payer uuid.UUID, total int64, rule SplitRule, participants []uuid.UUID) ([]Posting, error) {
	if total <= 0 || total > MaxAmount {
		return nil, fmt.Errorf("total must be in (0, %d], got %d", MaxAmount, total)
	}
	if len(participants) == 0 {
		return nil, fmt.Errorf("at least one participant required")
	}
	seen := make(map[uuid.UUID]bool, len(participants))
	for _, p := range participants {
		if seen[p] {
			return nil, fmt.Errorf("duplicate participant %s", p)
		}
		seen[p] = true
	}

	shares, err := computeShares(total, rule, participants)
	if err != nil {
		return nil, err
	}

	net := make(map[uuid.UUID]int64, len(participants)+1)
	for m, s := range shares {
		net[m] -= s
	}
	net[payer] += total

	members := make([]uuid.UUID, 0, len(net))
	for m, amt := range net {
		if amt != 0 {
			members = append(members, m)
		}
	}
	sort.Slice(members, func(i, j int) bool {
		return bytes.Compare(members[i][:], members[j][:]) < 0
	})
	postings := make([]Posting, len(members))
	for i, m := range members {
		postings[i] = Posting{MemberID: m, Amount: net[m]}
	}
	return postings, nil
}

// coversExactly ensures the rule's per-member map keys are exactly the participant set.
func coversExactly[V any](m map[uuid.UUID]V, participants []uuid.UUID) error {
	if len(m) != len(participants) {
		return fmt.Errorf("split rule covers %d members, entry has %d participants", len(m), len(participants))
	}
	for _, p := range participants {
		if _, ok := m[p]; !ok {
			return fmt.Errorf("split rule missing participant %s", p)
		}
	}
	return nil
}

func computeShares(total int64, rule SplitRule, participants []uuid.UUID) (map[uuid.UUID]int64, error) {
	switch rule.Type {
	case SplitEqual:
		w := make(map[uuid.UUID]int64, len(participants))
		for _, p := range participants {
			w[p] = 1
		}
		return weightedShares(total, w, participants)
	case SplitShares:
		if err := coversExactly(rule.Weights, participants); err != nil {
			return nil, err
		}
		return weightedShares(total, rule.Weights, participants)
	case SplitPercent:
		if err := coversExactly(rule.Weights, participants); err != nil {
			return nil, err
		}
		var sum int64
		for _, w := range rule.Weights {
			sum += w
		}
		if sum != 100 {
			return nil, fmt.Errorf("percentages must sum to 100, got %d", sum)
		}
		return weightedShares(total, rule.Weights, participants)
	case SplitExact:
		if err := coversExactly(rule.Amounts, participants); err != nil {
			return nil, err
		}
		var sum int64
		for m, a := range rule.Amounts {
			if a < 0 {
				return nil, fmt.Errorf("exact amount for %s must be >= 0, got %d", m, a)
			}
			sum += a
		}
		if sum != total {
			return nil, fmt.Errorf("exact amounts sum to %d, total is %d", sum, total)
		}
		out := make(map[uuid.UUID]int64, len(rule.Amounts))
		for m, a := range rule.Amounts {
			out[m] = a
		}
		return out, nil
	default:
		return nil, fmt.Errorf("unknown split type %q", rule.Type)
	}
}

// weightedShares distributes total across participants proportionally to
// weights using the largest-remainder method; remainder-yen ties are broken
// by ascending member UUID. Guarantees the shares sum to exactly total.
func weightedShares(total int64, weights map[uuid.UUID]int64, participants []uuid.UUID) (map[uuid.UUID]int64, error) {
	var totalWeight int64
	for _, p := range participants {
		w := weights[p]
		if w <= 0 || w > maxWeight {
			return nil, fmt.Errorf("weight for %s must be in (0, %d], got %d", p, maxWeight, w)
		}
		totalWeight += w
	}

	type remainder struct {
		member uuid.UUID
		rem    int64
	}
	shares := make(map[uuid.UUID]int64, len(participants))
	remainders := make([]remainder, 0, len(participants))
	var assigned int64
	for _, p := range participants {
		base := total * weights[p] / totalWeight
		shares[p] = base
		assigned += base
		remainders = append(remainders, remainder{p, total * weights[p] % totalWeight})
	}
	sort.Slice(remainders, func(i, j int) bool {
		if remainders[i].rem != remainders[j].rem {
			return remainders[i].rem > remainders[j].rem
		}
		return bytes.Compare(remainders[i].member[:], remainders[j].member[:]) < 0
	})
	for i := int64(0); i < total-assigned; i++ {
		shares[remainders[i].member]++
	}
	return shares, nil
}

// SettlementPostings records "payer paid counterparty amount": the payer's
// net position rises, the counterparty's falls. Output sorted by UUID bytes.
func SettlementPostings(payer, counterparty uuid.UUID, amount int64) ([]Posting, error) {
	if amount <= 0 || amount > MaxAmount {
		return nil, fmt.Errorf("settlement amount must be in (0, %d], got %d", MaxAmount, amount)
	}
	if payer == counterparty {
		return nil, fmt.Errorf("cannot settle with yourself")
	}
	postings := []Posting{{MemberID: payer, Amount: amount}, {MemberID: counterparty, Amount: -amount}}
	if bytes.Compare(postings[1].MemberID[:], postings[0].MemberID[:]) < 0 {
		postings[0], postings[1] = postings[1], postings[0]
	}
	return postings, nil
}
