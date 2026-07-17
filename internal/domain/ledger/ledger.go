// Package ledger computes double-entry postings for tally-up's append-only ledger.
// All amounts are integer yen. Computation is deterministic: identical inputs
// always produce identical postings (rounding included).
package ledger

import "github.com/google/uuid"

// MaxAmount caps totals at ¥100B so total*weight stays inside int64.
const MaxAmount = int64(100_000_000_000)

type SplitType string

const (
	SplitEqual   SplitType = "equal"
	SplitExact   SplitType = "exact"
	SplitShares  SplitType = "shares"
	SplitPercent SplitType = "percent"
)

// SplitRule is stored verbatim on the entry (JSONB) and applied at write time.
// Amounts is used by exact; Weights by shares and percent.
type SplitRule struct {
	Type    SplitType           `json:"type"`
	Amounts map[uuid.UUID]int64 `json:"amounts,omitempty"`
	Weights map[uuid.UUID]int64 `json:"weights,omitempty"`
}

// Posting is one member's signed net amount for an entry.
type Posting struct {
	MemberID uuid.UUID `json:"member_id"`
	Amount   int64     `json:"amount"`
}
