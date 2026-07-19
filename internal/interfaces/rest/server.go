// Package rest is the thin HTTP layer: decode, build a command, call the
// application service, translate the result.
package rest

import (
	"net/http"

	"tallyup/internal/application/addentry"
)

type Server struct {
	entries *addentry.Service
}

func NewServer(entries *addentry.Service) http.Handler {
	srv := &Server{entries: entries}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /groups/{group_id}/entries", srv.handleCreateEntry)
	return mux
}
