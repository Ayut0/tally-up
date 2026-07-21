// Package rest is the thin HTTP layer: decode, build a command, call the
// application service, translate the result.
package rest

import (
	"net/http"

	"tallyup/internal/application/addentry"
	"tallyup/internal/domain/entry"
)

type Server struct {
	entries  *addentry.Service
	balances entry.BalanceReader
	history  entry.HistoryReader
}

func NewServer(entries *addentry.Service, balances entry.BalanceReader, history entry.HistoryReader) http.Handler {
	srv := &Server{entries: entries, balances: balances, history: history}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /groups/{group_id}/entries", srv.handleCreateEntry)
	mux.HandleFunc("GET /groups/{group_id}/balance", srv.handleGetBalance)
	mux.HandleFunc("GET /groups/{group_id}/entries", srv.handleListEntries)
	return mux
}
