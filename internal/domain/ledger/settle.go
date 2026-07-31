package ledger

import (
	"bytes"
	"fmt"

	"github.com/google/uuid"
)

// Transfer is one proposed payment in a settle-up plan: From pays To Amount.
type Transfer struct {
	From   uuid.UUID `json:"from"`
	To     uuid.UUID `json:"to"`
	Amount int64     `json:"amount"`
}

// SettlePlan proposes transfers that drive every member's balance to zero:
// repeatedly match the largest debtor with the largest creditor (greedy;
// truly minimal transfer count is NP-hard, see architecture.md §5b), at most
// n-1 transfers for n nonzero balances. Ties break by ascending member UUID
// bytes so the same balances always yield a byte-identical plan.
//
// Non-zero-sum input is ledger corruption, not a client error, so it is
// rejected rather than silently normalized.
func SettlePlan(balances []Posting) ([]Transfer, error) {
	var sum int64
	for _, b := range balances {
		sum += b.Amount
	}
	if sum != 0 {
		return nil, fmt.Errorf("balances must sum to zero, got %d", sum)
	}

	remaining := make([]Posting, 0, len(balances))
	for _, b := range balances {
		if b.Amount != 0 {
			remaining = append(remaining, b)
		}
	}

	transfers := make([]Transfer, 0, max(len(remaining)-1, 0))
	for len(remaining) > 0 {
		creditor := &remaining[largestCreditor(remaining)]
		debtor := &remaining[largestDebtor(remaining)]
		amount := min(creditor.Amount, -debtor.Amount)
		transfers = append(transfers, Transfer{From: debtor.MemberID, To: creditor.MemberID, Amount: amount})
		creditor.Amount -= amount
		debtor.Amount += amount

		remaining = removeZeroed(remaining)
	}
	return transfers, nil
}

// largestCreditor returns the index of the member owed the most (max
// positive Amount) in bals, breaking ties by ascending member UUID bytes.
// bals must contain at least one positive Amount.
func largestCreditor(bals []Posting) int {
	best := -1
	for i, b := range bals {
		if b.Amount <= 0 {
			continue
		}
		if best == -1 || b.Amount > bals[best].Amount ||
			(b.Amount == bals[best].Amount && bytes.Compare(b.MemberID[:], bals[best].MemberID[:]) < 0) {
			best = i
		}
	}
	return best
}

// largestDebtor returns the index of the member who owes the most (min
// negative Amount) in bals, breaking ties by ascending member UUID bytes.
// bals must contain at least one negative Amount.
func largestDebtor(bals []Posting) int {
	best := -1
	for i, b := range bals {
		if b.Amount >= 0 {
			continue
		}
		if best == -1 || b.Amount < bals[best].Amount ||
			(b.Amount == bals[best].Amount && bytes.Compare(b.MemberID[:], bals[best].MemberID[:]) < 0) {
			best = i
		}
	}
	return best
}

// removeZeroed compacts bals in place, dropping entries whose Amount hit
// zero. Order of the remaining entries is preserved.
func removeZeroed(bals []Posting) []Posting {
	out := bals[:0]
	for _, b := range bals {
		if b.Amount != 0 {
			out = append(out, b)
		}
	}
	return out
}
