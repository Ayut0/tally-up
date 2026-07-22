package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func postReverse(t *testing.T, srv *httptest.Server, key uuid.UUID, entryID, reversalID uuid.UUID) (*http.Response, []byte) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"id": reversalID, "requested_by": yuto})
	req, _ := http.NewRequest("POST",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s/reverse", gID, entryID),
		bytes.NewReader(body))
	req.Header.Set("Idempotency-Key", key.String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	return resp, rb
}

func TestReverse_Endpoint(t *testing.T) {
	srv, s := newTestServer(t)
	entryID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(entryID))

	resp, body := postReverse(t, srv, uuid.New(), entryID, uuid.New())
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s", resp.StatusCode, body)
	}

	// Second reversal → 409; unknown entry → 404.
	resp, _ = postReverse(t, srv, uuid.New(), entryID, uuid.New())
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("double reversal: status %d, want 409", resp.StatusCode)
	}
	resp, _ = postReverse(t, srv, uuid.New(), uuid.New(), uuid.New())
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown entry: status %d, want 404", resp.StatusCode)
	}

	var sum int64
	s.Pool.QueryRow(context.Background(), `SELECT COALESCE(SUM(amount),0) FROM postings`).Scan(&sum)
	if sum != 0 {
		t.Fatalf("global sum %d after reversal, want 0", sum)
	}
}

func TestReverse_ReplayIdempotent(t *testing.T) {
	srv, s := newTestServer(t)
	entryID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(entryID))

	key, revID := uuid.New(), uuid.New()
	resp1, body1 := postReverse(t, srv, key, entryID, revID)
	resp2, body2 := postReverse(t, srv, key, entryID, revID)
	if resp1.StatusCode != http.StatusCreated || resp2.StatusCode != http.StatusOK {
		t.Fatalf("statuses %d/%d, want 201/200", resp1.StatusCode, resp2.StatusCode)
	}
	if !bytes.Equal(body1, body2) {
		t.Fatalf("replay differs: %s vs %s", body1, body2)
	}
	var n int
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries WHERE kind='reversal'`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d reversals, want 1", n)
	}
}

func TestEdit_Endpoint(t *testing.T) {
	srv, s := newTestServer(t)
	entryID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(entryID)) // 12000 3-way

	body, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "reversal_id": uuid.New(),
		"kind": "expense", "payer_id": yuto, "total_amount": 9000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, memA},
		"occurred_on":  "2026-07-05",
	})
	req, _ := http.NewRequest("PUT",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s", gID, entryID), bytes.NewReader(body))
	req.Header.Set("Idempotency-Key", uuid.New().String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusCreated {
		rb, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d, body %s", resp.StatusCode, rb)
	}

	var n int
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries`).Scan(&n)
	if n != 3 {
		t.Fatalf("%d entries after edit, want 3 (original + reversal + replacement)", n)
	}
	var sum int64
	s.Pool.QueryRow(context.Background(), `SELECT COALESCE(SUM(amount),0) FROM postings`).Scan(&sum)
	if sum != 0 {
		t.Fatalf("global sum %d, want 0", sum)
	}
}
