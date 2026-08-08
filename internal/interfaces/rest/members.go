package rest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/google/uuid"

	"tallyup/internal/application/addmember"
	"tallyup/internal/domain/group"
)

type addMemberRequest struct {
	Name string `json:"name"`
}

func (s *Server) handleAddMember(w http.ResponseWriter, r *http.Request) {
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

	var req addMemberRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	result, err := s.addMember.AddMember(r.Context(), addmember.Command{
		GroupID: groupID, Name: req.Name,
		IdempotencyKey: key, RequestHash: requestHash,
	})

	var valErr *addmember.ValidationError
	var gateErr *addmember.GateError
	switch {
	case errors.As(err, &valErr):
		httpError(w, http.StatusUnprocessableEntity, valErr.Error())
	case errors.As(err, &gateErr):
		httpError(w, http.StatusInternalServerError, "idempotency gate failed")
	case err != nil:
		httpError(w, http.StatusInternalServerError, "add member failed")
	default:
		writeGateResult(w, result.Gate, result.Body)
	}
}

func (s *Server) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	memberID, err := uuid.Parse(r.PathValue("member_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid member id")
		return
	}

	err = s.memberRemover.RemoveMember(r.Context(), groupID, memberID)
	switch {
	case errors.Is(err, group.ErrNonzeroBalance):
		httpError(w, http.StatusConflict, err.Error())
	case err != nil:
		httpError(w, http.StatusInternalServerError, "remove member failed")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
