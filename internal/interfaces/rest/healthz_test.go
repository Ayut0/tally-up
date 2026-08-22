package rest

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"tallyup/internal/application/addentry"
	"tallyup/internal/application/addmember"
	"tallyup/internal/application/correctentry"
	"tallyup/internal/application/creategroup"
	"tallyup/internal/application/proposesettleplan"
	"tallyup/internal/infrastructure/postgres/postgrestest"
)

// TestHealthz exercises GET /healthz directly, without wrapping the handler
// in validatingHandler: it is deploy/ops surface, not a spec/main.tsp
// operation, so it is out of scope for the openapi contract check — same
// reasoning as TestCreateGroup_CORSPreflight.
func TestHealthz(t *testing.T) {
	cases := []struct {
		name       string
		wantStatus int
	}{
		// http.NewRequest sets no Origin header by default — the same as
		// Fly's checker, which sends none.
		{name: "no Origin header, as Fly's checker sends", wantStatus: http.StatusOK},
	}

	s := postgrestest.Store(t)
	entries := &addentry.Service{Gate: s.Idempotency, Entries: s.Entries}
	corrections := &correctentry.Service{Gate: s.Idempotency, Reverses: s.Entries, Edits: s.Entries}
	groups := &creategroup.Service{Gate: s.Idempotency, Groups: s.Groups}
	settlePlans := &proposesettleplan.Service{Balances: s.Reads}
	addMember := &addmember.Service{Gate: s.Idempotency, Members: s.Groups}
	srv := httptest.NewServer(NewServer(entries, s.Reads, s.Reads, s.Reads, corrections, groups, s.Groups, settlePlans, addMember, s.Groups, "*"))
	t.Cleanup(srv.Close)

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodGet, srv.URL+"/healthz", nil)
			if err != nil {
				t.Fatal(err)
			}

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != tc.wantStatus {
				t.Fatalf("status %d, want %d", resp.StatusCode, tc.wantStatus)
			}
		})
	}
}
