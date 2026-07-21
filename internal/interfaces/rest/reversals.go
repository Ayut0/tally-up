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
	"tallyup/internal/application/correctentry"
	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/group"
)

type reverseRequest struct {
	ID          uuid.UUID `json:"id"`           // client-minted reversal entry id
	RequestedBy uuid.UUID `json:"requested_by"` // who is deleting (v1 has no authed identity)
}

func (s *Server) handleReverseEntry(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	entryID, err := uuid.Parse(r.PathValue("entry_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid entry id")
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

	var req reverseRequest
	if err := json.Unmarshal(body, &req); err != nil || req.ID == uuid.Nil || req.RequestedBy == uuid.Nil {
		httpError(w, http.StatusBadRequest, `body must be {"id": "<uuid>", "requested_by": "<member uuid>"}`)
		return
	}

	result, err := s.corrections.Reverse(r.Context(), correctentry.ReverseCommand{
		GroupID: groupID, OriginalID: entryID, ReversalID: req.ID, RequestedBy: req.RequestedBy,
		IdempotencyKey: key, RequestHash: requestHash,
	})

	var gateErr *addentry.GateError
	switch {
	case errors.Is(err, entry.ErrNotFound):
		httpError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, entry.ErrAlreadyReversed):
		httpError(w, http.StatusConflict, err.Error())
	case errors.Is(err, entry.ErrNotReversible):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.As(err, &gateErr):
		httpError(w, http.StatusInternalServerError, "idempotency gate failed")
	case err != nil:
		httpError(w, http.StatusInternalServerError, "reversal failed")
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

func (s *Server) handleEditEntry(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	originalID, err := uuid.Parse(r.PathValue("entry_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid entry id")
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
	if req.ID == uuid.Nil || req.ReversalID == uuid.Nil {
		httpError(w, http.StatusBadRequest, "id and reversal_id required")
		return
	}
	occurredOn, err := time.Parse("2006-01-02", req.OccurredOn)
	if err != nil {
		httpError(w, http.StatusBadRequest, "occurred_on must be YYYY-MM-DD")
		return
	}

	result, err := s.corrections.Edit(r.Context(), correctentry.EditCommand{
		GroupID: groupID, OriginalID: originalID, ReversalID: req.ReversalID,
		ID: req.ID, Kind: req.Kind, PayerID: req.PayerID, Counterparty: req.Counterparty,
		TotalAmount: req.TotalAmount, SplitRule: req.SplitRule, Participants: req.Participants,
		Memo: req.Memo, OccurredOn: occurredOn,
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
	case errors.Is(err, entry.ErrNotFound):
		httpError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, entry.ErrAlreadyReversed):
		httpError(w, http.StatusConflict, err.Error())
	case errors.Is(err, entry.ErrNotReversible):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, group.ErrNotMember):
		httpError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, entry.ErrDuplicateID):
		httpError(w, http.StatusConflict, err.Error())
	case errors.As(err, &gateErr):
		httpError(w, http.StatusInternalServerError, "idempotency gate failed")
	case err != nil:
		httpError(w, http.StatusInternalServerError, "edit failed")
	default:
		switch result.Gate {
		case entry.GateReplay:
			writeJSON(w, http.StatusOK, result.Body)
		case entry.GateInFlight:
			httpError(w, http.StatusConflict, "request in flight; retry shortly")
		case entry.GateMismatch:
			httpError(w, http.StatusUnprocessableEntity, "idempotency key reused with different payload")
		default:
			writeJSON(w, http.StatusCreated, result.Body)
		}
	}
}
