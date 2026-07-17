package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/ledger"
	"tallyup/internal/store"
)

const maxBodyBytes = 1 << 20

type createEntryRequest struct {
	ID           uuid.UUID        `json:"id"`
	Kind         string           `json:"kind"`
	PayerID      uuid.UUID        `json:"payer_id"`
	Counterparty *uuid.UUID       `json:"counterparty,omitempty"`
	TotalAmount  int64            `json:"total_amount"`
	SplitRule    ledger.SplitRule `json:"split_rule"`
	Participants []uuid.UUID      `json:"participants"`
	Memo         string           `json:"memo,omitempty"`
	OccurredOn   string           `json:"occurred_on"` // YYYY-MM-DD
}

func (s *Server) handleCreateEntry(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	key, err := uuid.Parse(r.Header.Get("Idempotency-Key"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "Idempotency-Key header (UUID) required")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		httpError(w, http.StatusBadRequest, "unreadable body")
		return
	}
	sum := sha256.Sum256(body)
	requestHash := hex.EncodeToString(sum[:])

	var req createEntryRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.ID == uuid.Nil {
		httpError(w, http.StatusBadRequest, "entry id required (client-generated UUID)")
		return
	}
	occurredOn, err := time.Parse("2006-01-02", req.OccurredOn)
	if err != nil {
		httpError(w, http.StatusBadRequest, "occurred_on must be YYYY-MM-DD")
		return
	}

	// Compute postings before the gate: pure validation, no DB cost.
	var postings []ledger.Posting
	var splitJSON []byte
	participants := req.Participants
	switch req.Kind {
	case "expense":
		postings, err = ledger.ComputePostings(req.PayerID, req.TotalAmount, req.SplitRule, req.Participants)
		if err == nil {
			splitJSON, err = json.Marshal(req.SplitRule)
		}
	case "settlement":
		if req.Counterparty == nil {
			httpError(w, http.StatusBadRequest, "settlement requires counterparty")
			return
		}
		postings, err = ledger.SettlementPostings(req.PayerID, *req.Counterparty, req.TotalAmount)
		// "settlement" is not one of ledger.SplitType's four constants (equal/exact/
		// shares/percent) — harmless today since nothing recomputes postings from
		// split_rule, but a future feature deserializing split_rule to recompute
		// postings must special-case kind == "settlement" rather than treating this
		// as a ledger.SplitType.
		splitJSON = []byte(`{"type":"settlement"}`)
		participants = []uuid.UUID{req.PayerID, *req.Counterparty}
	default:
		httpError(w, http.StatusBadRequest, "kind must be expense or settlement")
		return
	}
	if err != nil {
		httpError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	gate, stored, err := s.store.AcquireIdempotencyKey(r.Context(), key, requestHash)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "idempotency gate failed")
		return
	}
	switch gate {
	case store.GateReplay:
		writeJSON(w, http.StatusOK, stored)
		return
	case store.GateInFlight:
		httpError(w, http.StatusConflict, "request in flight; retry shortly")
		return
	case store.GateMismatch:
		httpError(w, http.StatusUnprocessableEntity, "idempotency key reused with different payload")
		return
	}

	resp, err := s.store.CreateEntry(r.Context(), key, store.EntryInput{
		ID: req.ID, GroupID: groupID, Kind: req.Kind, PayerID: req.PayerID,
		Counterparty: req.Counterparty, TotalAmount: req.TotalAmount,
		SplitRule: splitJSON, Participants: participants, Memo: req.Memo,
		// CreatedBy is hardwired to PayerID for now, conflating "who recorded the
		// entry" with "who paid" — placeholder pending real auth.
		OccurredOn: occurredOn, CreatedBy: req.PayerID,
	}, postings)
	if err != nil {
		// We own the pending row; free it so the client's retry isn't stuck
		// behind the janitor. Best-effort — the janitor is the backstop.
		if relErr := s.store.ReleaseIdempotencyKey(r.Context(), key); relErr != nil {
			slog.Warn("release idempotency key", "key", key, "err", relErr)
		}
	}
	switch {
	case errors.Is(err, store.ErrNotGroupMembers):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, store.ErrDuplicateEntryID):
		httpError(w, http.StatusConflict, err.Error())
	case err != nil:
		httpError(w, http.StatusInternalServerError, "write failed")
	default:
		writeJSON(w, http.StatusCreated, resp)
	}
}

func writeJSON(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}

func httpError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
