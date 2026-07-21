package rest

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
)

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
	json.NewEncoder(w).Encode(snap)
}
