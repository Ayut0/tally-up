// Package rest is the thin HTTP layer: decode, build a command, call the
// application service, translate the result.
package rest

import (
	"net/http"

	"tallyup/internal/application/addentry"
	"tallyup/internal/application/addmember"
	"tallyup/internal/application/correctentry"
	"tallyup/internal/application/creategroup"
	"tallyup/internal/application/proposesettleplan"
	"tallyup/internal/domain/entry"
	"tallyup/internal/domain/group"
)

type Server struct {
	entries       *addentry.Service
	balances      entry.BalanceReader
	pairwise      entry.PairwiseReader
	history       entry.HistoryReader
	corrections   *correctentry.Service
	groups        *creategroup.Service
	groupReader   group.Reader
	settlePlans   *proposesettleplan.Service
	addMember     *addmember.Service
	memberRemover group.MemberRemover
}

func NewServer(entries *addentry.Service, balances entry.BalanceReader, pairwise entry.PairwiseReader, history entry.HistoryReader, corrections *correctentry.Service, groups *creategroup.Service, groupReader group.Reader, settlePlans *proposesettleplan.Service, addMember *addmember.Service, memberRemover group.MemberRemover, corsOrigin string) http.Handler {
	srv := &Server{
		entries: entries, balances: balances, pairwise: pairwise, history: history, corrections: corrections,
		groups: groups, groupReader: groupReader, settlePlans: settlePlans, addMember: addMember,
		memberRemover: memberRemover,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /groups", srv.handleCreateGroup)
	mux.HandleFunc("GET /groups/{group_id}", srv.handleGetGroup)
	mux.HandleFunc("POST /groups/{group_id}/entries", srv.handleCreateEntry)
	mux.HandleFunc("GET /groups/{group_id}/balance", srv.handleGetBalance)
	mux.HandleFunc("GET /groups/{group_id}/pairwise-balances", srv.handleGetPairwiseBalances)
	mux.HandleFunc("GET /groups/{group_id}/settle-plan", srv.handleGetSettlePlan)
	mux.HandleFunc("GET /groups/{group_id}/entries", srv.handleListEntries)
	mux.HandleFunc("POST /groups/{group_id}/entries/{entry_id}/reverse", srv.handleReverseEntry)
	mux.HandleFunc("PUT /groups/{group_id}/entries/{entry_id}", srv.handleEditEntry)
	mux.HandleFunc("POST /groups/{group_id}/members", srv.handleAddMember)
	mux.HandleFunc("DELETE /groups/{group_id}/members/{member_id}", srv.handleRemoveMember)
	return corsMiddleware(corsOrigin, mux)
}

// corsMiddleware lets the Next.js web client (a different origin) call this
// API. An empty origin means "no CORS_ORIGIN configured" — default to `*`
// rather than failing closed, since this API has no cookie-based auth for
// CORS to protect (see architecture.md's sharing model: capability URLs and
// an optional HMAC token, not cookies).
func corsMiddleware(origin string, next http.Handler) http.Handler {
	if origin == "" {
		origin = "*"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
