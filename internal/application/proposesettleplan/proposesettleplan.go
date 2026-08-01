// Package proposesettleplan implements the read path's settle-up
// application service: read the current balance snapshot, then compute the
// greedy transfer plan over it. It exists as a service (not handler code)
// because #122 reuses Propose to build the recomputed plan in its 409 body.
package proposesettleplan

import (
	"context"

	"github.com/google/uuid"

	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
)

// Result is a settle-up plan: the proposed transfers plus the balance
// snapshot's seq they were computed from.
type Result struct {
	Transfers []ledger.Transfer
	AsOfSeq   int64
}

type Service struct {
	Balances entry.BalanceReader
}

func (s *Service) Propose(ctx context.Context, groupID uuid.UUID) (Result, error) {
	snap, err := s.Balances.GetBalances(ctx, groupID)
	if err != nil {
		return Result{}, err
	}

	postings := make([]ledger.Posting, len(snap.Balances))
	for i, b := range snap.Balances {
		postings[i] = ledger.Posting{MemberID: b.MemberID, Amount: b.Balance}
	}

	transfers, err := ledger.SettlePlan(postings)
	if err != nil {
		return Result{}, err
	}
	return Result{Transfers: transfers, AsOfSeq: snap.AsOfSeq}, nil
}
