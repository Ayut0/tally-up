package rest

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/application/proposesettleplan"
	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/ledger"
)

// This layer's own wire vocabulary for reads. interfaces/rest translates
// domain reads into these explicitly rather than json-encoding
// entry.BalanceSnapshot / entry.Record straight through (server.go's stated
// job), so a domain field rename fails this file to compile instead of
// silently changing the wire contract.

type memberBalanceResponse struct {
	MemberID uuid.UUID `json:"member_id"`
	Balance  int64     `json:"balance"`
}

type balanceResponse struct {
	Balances []memberBalanceResponse `json:"balances"`
	AsOfSeq  int64                   `json:"as_of_seq"`
}

func newBalanceResponse(snap entry.BalanceSnapshot) balanceResponse {
	balances := make([]memberBalanceResponse, len(snap.Balances))
	for i, b := range snap.Balances {
		balances[i] = memberBalanceResponse{MemberID: b.MemberID, Balance: b.Balance}
	}
	return balanceResponse{Balances: balances, AsOfSeq: snap.AsOfSeq}
}

type entryResponse struct {
	ID           uuid.UUID        `json:"id"`
	Seq          int64            `json:"seq"`
	Kind         entry.Kind       `json:"kind"`
	ReversesID   *uuid.UUID       `json:"reverses_id,omitempty"`
	PayerID      uuid.UUID        `json:"payer_id"`
	Counterparty *uuid.UUID       `json:"counterparty,omitempty"`
	TotalAmount  int64            `json:"total_amount"`
	SplitRule    json.RawMessage  `json:"split_rule"`
	Participants []uuid.UUID      `json:"participants"`
	Memo         *string          `json:"memo,omitempty"`
	OccurredOn   string           `json:"occurred_on"`
	CreatedBy    uuid.UUID        `json:"created_by"`
	CreatedAt    time.Time        `json:"created_at"`
	Postings     []ledger.Posting `json:"postings"`
}

func newEntryResponse(r entry.Record) entryResponse {
	return entryResponse{
		ID: r.ID, Seq: r.Seq, Kind: r.Kind, ReversesID: r.ReversesID,
		PayerID: r.PayerID, Counterparty: r.Counterparty, TotalAmount: r.TotalAmount,
		SplitRule: r.SplitRule, Participants: r.Participants, Memo: r.Memo,
		OccurredOn: r.OccurredOn, CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt,
		Postings: r.Postings,
	}
}

type entryListResponse struct {
	Entries []entryResponse `json:"entries"`
}

func (s *Server) handleGetBalance(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	snap, err := s.balances.GetBalances(r.Context(), groupID)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "balance read failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(newBalanceResponse(snap)); err != nil {
		slog.Warn("write balance response", "err", err)
	}
}

type transferResponse struct {
	From   uuid.UUID `json:"from"`
	To     uuid.UUID `json:"to"`
	Amount int64     `json:"amount"`
}

type settlePlanResponse struct {
	Transfers []transferResponse `json:"transfers"`
	AsOfSeq   int64              `json:"as_of_seq"`
}

func newSettlePlanResponse(res proposesettleplan.Result) settlePlanResponse {
	transfers := make([]transferResponse, len(res.Transfers))
	for i, t := range res.Transfers {
		transfers[i] = transferResponse{From: t.From, To: t.To, Amount: t.Amount}
	}
	return settlePlanResponse{Transfers: transfers, AsOfSeq: res.AsOfSeq}
}

func (s *Server) handleGetSettlePlan(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	plan, err := s.settlePlans.Propose(r.Context(), groupID)
	if err != nil {
		// A settle plan can only fail on non-zero-sum balances — ledger
		// corruption, not a client error — so this must be loud, not a
		// silently swallowed 500.
		slog.Error("settle plan failed", "group_id", groupID, "err", err)
		httpError(w, http.StatusInternalServerError, "settle plan failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(newSettlePlanResponse(plan)); err != nil {
		slog.Warn("write settle plan response", "err", err)
	}
}

func (s *Server) handleListEntries(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	afterSeq, _ := strconv.ParseInt(r.URL.Query().Get("after_seq"), 10, 64) // absent → 0
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))                    // absent → 0 → store default
	records, err := s.history.ListEntries(r.Context(), groupID, afterSeq, limit)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "history read failed")
		return
	}
	resp := entryListResponse{Entries: make([]entryResponse, len(records))}
	for i, rec := range records {
		resp.Entries[i] = newEntryResponse(rec)
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		slog.Warn("write entries response", "err", err)
	}
}
