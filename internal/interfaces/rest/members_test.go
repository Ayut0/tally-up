package rest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func addMemberBody(name string) []byte {
	b, _ := json.Marshal(map[string]string{"name": name})
	return b
}

func postMember(t *testing.T, srv *httptest.Server, key uuid.UUID, body []byte) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest("POST", srv.URL+fmt.Sprintf("/groups/%s/members", gID), bytes.NewReader(body))
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

func TestAddMember_Endpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, body := postMember(t, srv, uuid.New(), addMemberBody("new friend"))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s", resp.StatusCode, body)
	}
	var added struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	}
	if err := json.Unmarshal(body, &added); err != nil {
		t.Fatalf("unmarshal %s: %v", body, err)
	}
	if added.Name != "new friend" || added.ID == uuid.Nil {
		t.Fatalf("bad response: %+v", added)
	}
}

func TestAddMember_ReplaySameKey(t *testing.T) {
	srv, _ := newTestServer(t)
	key, body := uuid.New(), addMemberBody("new friend")
	resp1, body1 := postMember(t, srv, key, body)
	resp2, body2 := postMember(t, srv, key, body)
	if resp1.StatusCode != http.StatusCreated || resp2.StatusCode != http.StatusOK {
		t.Fatalf("statuses %d/%d, want 201/200", resp1.StatusCode, resp2.StatusCode)
	}
	if !bytes.Equal(body1, body2) {
		t.Fatalf("replay body differs: %s vs %s", body1, body2)
	}
}

func TestAddMember_BlankNameRejected(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, _ := postMember(t, srv, uuid.New(), addMemberBody("   "))
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422", resp.StatusCode)
	}
}

func TestAddMember_MissingIdempotencyKeyIs400(t *testing.T) {
	srv, _ := newTestServer(t)
	req, _ := http.NewRequest("POST", srv.URL+fmt.Sprintf("/groups/%s/members", gID),
		bytes.NewReader(addMemberBody("new friend")))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", resp.StatusCode)
	}
}
