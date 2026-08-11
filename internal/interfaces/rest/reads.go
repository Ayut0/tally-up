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
	SplitRule    json.RawMessage  `json:"split_rule,omitempty"`
	Participants []uuid.UUID      `json:"participants"`
	Memo         *string          `json:"memo,omitempty"`
	OccurredOn   string           `json:"occurred_on"`
	CreatedBy    uuid.UUID        `json:"created_by"`
	CreatedAt    time.Time        `json:"created_at"`
	Postings     []ledger.Posting `json:"postings"`
}

func newEntryResponse(r entry.Record) entryResponse {
	resp := entryResponse{
		ID: r.ID, Seq: r.Seq, Kind: r.Kind, ReversesID: r.ReversesID,
		PayerID: r.PayerID, Counterparty: r.Counterparty, TotalAmount: r.TotalAmount,
		Participants: r.Participants, Memo: r.Memo,
		OccurredOn: r.OccurredOn, CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt,
		Postings: r.Postings,
	}
	// Only "expense" entries carry a real split rule (#160): settlement and
	// reversal store a placeholder that isn't a SplitRule union member, so
	// omitting it here — rather than echoing the placeholder — is what keeps
	// this response a member of the (now-optional) wire field.
	if r.Kind == entry.KindExpense {
		resp.SplitRule = r.SplitRule
	}
	return resp
}

type entryListResponse struct {
	Entries []entryResponse `json:"entries"`
	HasMore bool            `json:"has_more"`
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

type pairwiseBalanceResponse struct {
	DebtorID   uuid.UUID `json:"debtor_id"`
	CreditorID uuid.UUID `json:"creditor_id"`
	Amount     int64     `json:"amount"`
}

// pairwiseBalanceListResponse is the whole HTTP response body; each item in
// it is a pairwiseBalanceResponse — same "X" + "ListResponse" wrapper /
// "X" + "Response" item convention as entryListResponse/entryResponse below,
// rather than the singular/plural-only pairwiseBalanceResponse/
// pairwiseBalancesResponse names this replaced (too easy to misread as the
// same type).
type pairwiseBalanceListResponse struct {
	Balances []pairwiseBalanceResponse `json:"balances"`
}

func newPairwiseBalanceListResponse(pairs []entry.PairwiseBalance) pairwiseBalanceListResponse {
	balances := make([]pairwiseBalanceResponse, len(pairs))
	for i, p := range pairs {
		balances[i] = pairwiseBalanceResponse{DebtorID: p.DebtorID, CreditorID: p.CreditorID, Amount: p.Amount}
	}
	return pairwiseBalanceListResponse{Balances: balances}
}

func (s *Server) handleGetPairwiseBalances(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	pairs, err := s.pairwise.GetPairwiseBalances(r.Context(), groupID)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "pairwise balance read failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(newPairwiseBalanceListResponse(pairs)); err != nil {
		slog.Warn("write pairwise balances response", "err", err)
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
		// Beyond a transient read failure, this can mean SettlePlan rejected
		// non-zero-sum balances — ledger corruption, not a client error — so
		// this must be loud, not a silently swallowed 500.
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
	afterSeq, _ := strconv.ParseInt(r.URL.Query().Get("after_seq"), 10, 64)   // absent → 0
	beforeSeq, _ := strconv.ParseInt(r.URL.Query().Get("before_seq"), 10, 64) // absent → 0
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))                      // absent → 0 → store default
	if afterSeq > 0 && beforeSeq > 0 {
		httpError(w, http.StatusBadRequest, "after_seq and before_seq are mutually exclusive")
		return
	}
	records, hasMore, err := s.history.ListEntries(r.Context(), groupID, afterSeq, beforeSeq, limit)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "history read failed")
		return
	}
	resp := entryListResponse{Entries: make([]entryResponse, len(records)), HasMore: hasMore}
	for i, rec := range records {
		resp.Entries[i] = newEntryResponse(rec)
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		slog.Warn("write entries response", "err", err)
	}
}
