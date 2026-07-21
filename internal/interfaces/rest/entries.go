package rest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/application/addentry"
	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/group"
	"tallyup/internal/domain/ledger"
)

const maxBodyBytes = 1 << 20

type createEntryRequest struct {
	ID           uuid.UUID        `json:"id"`
	Kind         entry.Kind       `json:"kind"`
	PayerID      uuid.UUID        `json:"payer_id"`
	Counterparty *uuid.UUID       `json:"counterparty,omitempty"`
	TotalAmount  int64            `json:"total_amount"`
	SplitRule    ledger.SplitRule `json:"split_rule"`
	Participants []uuid.UUID      `json:"participants"`
	Memo         string           `json:"memo,omitempty"`
	OccurredOn   string           `json:"occurred_on"` // YYYY-MM-DD
	ReversalID   uuid.UUID        `json:"reversal_id,omitempty"` // PUT (edit) only
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

	result, err := s.entries.AddEntry(r.Context(), addentry.Command{
		ID: req.ID, GroupID: groupID, Kind: req.Kind, PayerID: req.PayerID,
		Counterparty: req.Counterparty, TotalAmount: req.TotalAmount,
		SplitRule: req.SplitRule, Participants: req.Participants, Memo: req.Memo,
		// CreatedBy is hardwired to PayerID for now, conflating "who recorded the
		// entry" with "who paid" — placeholder pending real auth.
		OccurredOn: occurredOn, CreatedBy: req.PayerID,
		IdempotencyKey: key, RequestHash: requestHash,
	})

	var valErr *addentry.ValidationError
	var gateErr *addentry.GateError
	switch {
	case errors.Is(err, addentry.ErrCounterpartyRequired):
		httpError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, addentry.ErrUnknownKind):
		httpError(w, http.StatusBadRequest, err.Error())
	case errors.As(err, &valErr):
		httpError(w, http.StatusUnprocessableEntity, valErr.Error())
	case errors.Is(err, group.ErrNotMember):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, entry.ErrDuplicateID):
		httpError(w, http.StatusConflict, err.Error())
	case errors.As(err, &gateErr):
		httpError(w, http.StatusInternalServerError, "idempotency gate failed")
	case err != nil:
		httpError(w, http.StatusInternalServerError, "write failed")
	default:
		switch result.Gate {
		case entry.GateReplay:
			writeJSON(w, http.StatusOK, result.Body)
		case entry.GateInFlight:
			httpError(w, http.StatusConflict, "request in flight; retry shortly")
		case entry.GateMismatch:
			httpError(w, http.StatusUnprocessableEntity, "idempotency key reused with different payload")
		default: // entry.GateProceed
			writeJSON(w, http.StatusCreated, result.Body)
		}
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
