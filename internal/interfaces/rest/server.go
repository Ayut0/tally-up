// Package rest is the thin HTTP layer: decode, build a command, call the
// application service, translate the result.
package rest

import (
	"net/http"

	"tallyup/internal/application/addentry"
	"tallyup/internal/application/correctentry"
	"tallyup/internal/domain/entry"
)

type Server struct {
	entries     *addentry.Service
	balances    entry.BalanceReader
	history     entry.HistoryReader
	corrections *correctentry.Service
}

func NewServer(entries *addentry.Service, balances entry.BalanceReader, history entry.HistoryReader, corrections *correctentry.Service) http.Handler {
	srv := &Server{entries: entries, balances: balances, history: history, corrections: corrections}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /groups/{group_id}/entries", srv.handleCreateEntry)
	mux.HandleFunc("GET /groups/{group_id}/balance", srv.handleGetBalance)
	mux.HandleFunc("GET /groups/{group_id}/entries", srv.handleListEntries)
	mux.HandleFunc("POST /groups/{group_id}/entries/{entry_id}/reverse", srv.handleReverseEntry)
	return mux
}
