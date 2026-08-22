package rest

import "net/http"

// handleHealthz is Fly's liveness probe and the deploy smoke-check's target
// between deploying the API and deploying the web client (#257). It
// deliberately does not touch Postgres: Neon scales to zero, so a cold
// database is normal, not broken — a DB-touching check would turn a routine
// cold start into a failed health check, and Fly reacts to a failed check by
// restarting the machine, producing a restart loop triggered by nothing
// being wrong. A readiness-style check that does touch the database belongs
// on a separate path that nothing is wired to auto-restart on.
func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []byte(`{"status":"ok"}`))
}
