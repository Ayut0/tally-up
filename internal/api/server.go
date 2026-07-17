// Package api is the thin HTTP layer: decode, validate, gate, one store call.
package api

import (
	"net/http"

	"tallyup/internal/store"
)

type Server struct {
	store *store.Store
}

func NewServer(s *store.Store) http.Handler {
	srv := &Server{store: s}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /groups/{group_id}/entries", srv.handleCreateEntry)
	return mux
}
