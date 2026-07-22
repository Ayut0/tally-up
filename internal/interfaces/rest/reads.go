package rest

import (
	"encoding/json"
	"net/http"
	"strconv"

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

func (s *Server) handleListEntries(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	afterSeq, _ := strconv.ParseInt(r.URL.Query().Get("after_seq"), 10, 64) // absent → 0
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))                    // absent → 0 → store default
	entries, err := s.history.ListEntries(r.Context(), groupID, afterSeq, limit)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "history read failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"entries": entries})
}
