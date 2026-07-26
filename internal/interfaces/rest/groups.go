package rest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/google/uuid"

	"tallyup/internal/application/creategroup"
	"tallyup/internal/domain/group"
)

type createGroupRequest struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	MemberNames []string  `json:"member_names"`
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
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

	var req createGroupRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.ID == uuid.Nil {
		httpError(w, http.StatusBadRequest, "group id required (client-generated UUID)")
		return
	}

	result, err := s.groups.CreateGroup(r.Context(), creategroup.Command{
		ID: req.ID, Name: req.Name, MemberNames: req.MemberNames,
		IdempotencyKey: key, RequestHash: requestHash,
	})

	var valErr *creategroup.ValidationError
	var gateErr *creategroup.GateError
	switch {
	case errors.As(err, &valErr):
		httpError(w, http.StatusUnprocessableEntity, valErr.Error())
	case errors.Is(err, group.ErrDuplicateID):
		httpError(w, http.StatusConflict, err.Error())
	case errors.As(err, &gateErr):
		httpError(w, http.StatusInternalServerError, "idempotency gate failed")
	case err != nil:
		httpError(w, http.StatusInternalServerError, "write failed")
	default:
		writeGateResult(w, result.Gate, result.Body)
	}
}

func (s *Server) handleGetGroup(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}

	rec, err := s.groupReader.GetGroup(r.Context(), groupID)
	switch {
	case errors.Is(err, group.ErrNotFound):
		httpError(w, http.StatusNotFound, err.Error())
	case err != nil:
		httpError(w, http.StatusInternalServerError, "read failed")
	default:
		body, err := json.Marshal(rec)
		if err != nil {
			httpError(w, http.StatusInternalServerError, "encode failed")
			return
		}
		writeJSON(w, http.StatusOK, body)
	}
}
