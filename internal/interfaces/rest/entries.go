package rest

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

	"tallyup/internal/application/addentry"
	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/group"
	"tallyup/internal/domain/ledger"
)

const maxBodyBytes = 1 << 20

// splitRuleRequest is this layer's own wire shape for split_rule — the spec's
// kind-discriminated union (spec/main.tsp) — decoded and explicitly converted
// to ledger.SplitRule rather than decoding straight into the domain type. A
// mismatched combination (e.g. type: "shares" with no weights) still surfaces
// as a 422 from ledger.ComputePostings's coversExactly check, same as before;
// this only stops a domain field rename from silently changing what the wire
// accepts.
type splitRuleRequest struct {
	Type    ledger.SplitType    `json:"type"`
	Amounts map[uuid.UUID]int64 `json:"amounts,omitempty"`
	Weights map[uuid.UUID]int64 `json:"weights,omitempty"`
}

func (r splitRuleRequest) toDomain() ledger.SplitRule {
	return ledger.SplitRule{Type: r.Type, Amounts: r.Amounts, Weights: r.Weights}
}

type createEntryRequest struct {
	ID uuid.UUID `json:"id"`
	// Which member is recording this — distinct from PayerID, who may not be
	// the one submitting the request (v1 has no authenticated identity).
	RequestedBy  uuid.UUID        `json:"requested_by"`
	Kind         entry.Kind       `json:"kind"`
	PayerID      uuid.UUID        `json:"payer_id"`
	Counterparty *uuid.UUID       `json:"counterparty,omitempty"`
	TotalAmount  int64            `json:"total_amount"`
	SplitRule    splitRuleRequest `json:"split_rule"`
	Participants []uuid.UUID      `json:"participants"`
	Memo         string           `json:"memo,omitempty"`
	OccurredOn   string           `json:"occurred_on"` // YYYY-MM-DD
	// PUT (edit) only: the client-minted reversal that retires the original.
	// Distinct from an entry's reverses_id, which points the other way — from a
	// reversal at the entry it reverses.
	ReversalID uuid.UUID `json:"reversal_entry_id,omitempty"`
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
	if req.RequestedBy == uuid.Nil {
		httpError(w, http.StatusBadRequest, "requested_by required (the recording member's id)")
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
		SplitRule: req.SplitRule.toDomain(), Participants: req.Participants, Memo: req.Memo,
		OccurredOn: occurredOn, CreatedBy: req.RequestedBy,
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
		writeGateResult(w, result.Gate, result.Body)
	}
}

func writeGateResult(w http.ResponseWriter, gate entry.GateResult, body []byte) {
	switch gate {
	case entry.GateReplay:
		writeJSON(w, http.StatusOK, body)
	case entry.GateInFlight:
		httpError(w, http.StatusConflict, "request in flight; retry shortly")
	case entry.GateMismatch:
		httpError(w, http.StatusUnprocessableEntity, "idempotency key reused with different payload")
	default: // entry.GateProceed
		writeJSON(w, http.StatusCreated, body)
	}
}

func writeJSON(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if _, err := w.Write(body); err != nil {
		slog.Warn("write response", "err", err)
	}
}

func httpError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]string{"error": msg}); err != nil {
		slog.Warn("write error response", "err", err)
	}
}
