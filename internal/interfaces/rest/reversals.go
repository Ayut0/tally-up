package rest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/google/uuid"

	"tallyup/internal/application/addentry"
	"tallyup/internal/application/correctentry"
	"tallyup/internal/domain/entry"
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
