package rest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"tallyup/internal/application/addentry"
	"tallyup/internal/application/addmember"
	"tallyup/internal/application/correctentry"
	"tallyup/internal/application/creategroup"
	"tallyup/internal/application/proposesettleplan"
	"tallyup/internal/infrastructure/postgres/postgrestest"
)

func createGroupBody(id uuid.UUID, name string, memberNames []string) []byte {
	b, _ := json.Marshal(map[string]any{
		"id": id, "name": name, "member_names": memberNames,
	})
	return b
}

func postGroup(t *testing.T, srv *httptest.Server, key uuid.UUID, body []byte) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest("POST", srv.URL+"/groups", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key.String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	rb, _ := io.ReadAll(resp.Body)
	return resp, rb
}

func getGroup(t *testing.T, srv *httptest.Server, id uuid.UUID) (*http.Response, []byte) {
	t.Helper()
	resp, err := http.Get(srv.URL + "/groups/" + id.String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	rb, _ := io.ReadAll(resp.Body)
	return resp, rb
}

func TestCreateGroup_ThenGet_HappyPath(t *testing.T) {
	srv, _ := newTestServer(t)
	groupID := uuid.New()

	createResp, createBody := postGroup(t, srv, uuid.New(), createGroupBody(groupID, "trip", []string{"yuto", "a", "b"}))
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create status %d, body %s", createResp.StatusCode, createBody)
	}
	var created struct {
		ID      uuid.UUID `json:"id"`
		Name    string    `json:"name"`
		Members []struct {
			ID   uuid.UUID `json:"id"`
			Name string    `json:"name"`
		} `json:"members"`
	}
	if err := json.Unmarshal(createBody, &created); err != nil {
		t.Fatalf("unmarshal create body: %v", err)
	}
	if created.ID != groupID || created.Name != "trip" || len(created.Members) != 3 {
		t.Fatalf("created = %+v", created)
	}

	getResp, getBody := getGroup(t, srv, groupID)
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("get status %d, body %s", getResp.StatusCode, getBody)
	}
	var fetched struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	}
	if err := json.Unmarshal(getBody, &fetched); err != nil {
		t.Fatalf("unmarshal get body: %v", err)
	}
	if fetched.ID != groupID || fetched.Name != "trip" {
		t.Fatalf("fetched = %+v", fetched)
	}
}

func TestGetGroup_RandomIDIs404(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, body := getGroup(t, srv, uuid.New())
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status %d, body %s, want 404", resp.StatusCode, body)
	}
}

func TestCreateGroup_Validation(t *testing.T) {
	cases := []struct {
		name        string
		groupName   string
		memberNames []string
	}{
		{"no members", "trip", []string{}},
		{"blank name", "  ", []string{"yuto"}},
		{"blank member name", "trip", []string{"yuto", "  "}},
		{"21 members", "trip", make([]string, 21)},
	}
	for i := range cases[3].memberNames {
		cases[3].memberNames[i] = fmt.Sprintf("m%d", i)
	}

	srv, _ := newTestServer(t)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, body := postGroup(t, srv, uuid.New(), createGroupBody(uuid.New(), tc.groupName, tc.memberNames))
			if resp.StatusCode != http.StatusUnprocessableEntity {
				t.Fatalf("status %d, body %s, want 422", resp.StatusCode, body)
			}
		})
	}
}

// TestCreateGroup_CORSPreflight exercises corsMiddleware directly, without
// wrapping the handler in validatingHandler: OPTIONS preflight is transport
// middleware, not a spec/main.tsp operation, so it is out of scope for the
// openapi contract check.
func TestCreateGroup_CORSPreflight(t *testing.T) {
	s := postgrestest.Store(t)
	entries := &addentry.Service{Gate: s.Idempotency, Entries: s.Entries}
	corrections := &correctentry.Service{Gate: s.Idempotency, Reverses: s.Entries, Edits: s.Entries}
	groups := &creategroup.Service{Gate: s.Idempotency, Groups: s.Groups}
	settlePlans := &proposesettleplan.Service{Balances: s.Reads}
	addMember := &addmember.Service{Gate: s.Idempotency, Members: s.Groups}
	srv := httptest.NewServer(NewServer(entries, s.Reads, s.Reads, s.Reads, corrections, groups, s.Groups, settlePlans, addMember, s.Groups, "*"))
	t.Cleanup(srv.Close)

	req, _ := http.NewRequest(http.MethodOptions, srv.URL+"/groups", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d, want 204", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want *", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Headers"); !strings.Contains(got, "Idempotency-Key") {
		t.Fatalf("Access-Control-Allow-Headers = %q, want it to contain Idempotency-Key", got)
	}
}
