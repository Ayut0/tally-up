package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"sort"
	"testing"

	"github.com/google/uuid"
)

func postReverse(t *testing.T, srv *httptest.Server, key uuid.UUID, entryID, reversalID uuid.UUID) (*http.Response, []byte) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"id": reversalID, "requested_by": yuto})
	req, _ := http.NewRequest("POST",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s/reverse", gID, entryID),
		bytes.NewReader(body))
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
	if err := s.Pool.QueryRow(context.Background(), `SELECT COALESCE(SUM(amount),0) FROM postings`).Scan(&sum); err != nil {
		t.Fatal(err)
	}
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
	if err := s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries WHERE kind='reversal'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("%d reversals, want 1", n)
	}
}

// Same backdoor as create/edit: an outsider named as requested_by on the
// bare reverse endpoint must not bypass group membership.
func TestReverse_Endpoint_NonMemberRequesterIs422(t *testing.T) {
	srv, _ := newTestServer(t)
	entryID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(entryID))
	outsider := uuid.New()

	body, _ := json.Marshal(map[string]any{"id": uuid.New(), "requested_by": outsider})
	req, _ := http.NewRequest("POST",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s/reverse", gID, entryID),
		bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", uuid.New().String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnprocessableEntity {
		rb, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d, body %s, want 422", resp.StatusCode, rb)
	}
}

func TestEdit_Endpoint(t *testing.T) {
	srv, s := newTestServer(t)
	entryID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(entryID)) // 12000 3-way

	body, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "reversal_entry_id": uuid.New(),
		"kind": "expense", "payer_id": yuto, "requested_by": yuto, "total_amount": 9000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, memA},
		"occurred_on":  "2026-07-05",
	})
	req, _ := http.NewRequest("PUT",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s", gID, entryID), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
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
	if err := s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("%d entries after edit, want 3 (original + reversal + replacement)", n)
	}
	var sum int64
	if err := s.Pool.QueryRow(context.Background(), `SELECT COALESCE(SUM(amount),0) FROM postings`).Scan(&sum); err != nil {
		t.Fatal(err)
	}
	if sum != 0 {
		t.Fatalf("global sum %d, want 0", sum)
	}
}

// payer_id and created_by are deliberately separate: memA can record an
// expense yuto paid for. The replacement entry and its reversal must both be
// attributed to memA (the one editing), never to yuto (the payer).
//
// Asserted via direct SQL rather than GET /entries: a reversal's
// split_rule.type is the literal string "reversal", which the OpenAPI
// SplitRule union (equal/exact/shares/percent only) does not accept — a
// pre-existing contract gap, out of scope here, that the list endpoint's
// response validation would otherwise trip on.
func TestEdit_Endpoint_AttributesToRequester(t *testing.T) {
	srv, s := newTestServer(t)
	entryID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(entryID)) // yuto pays 12000, 3-way

	newID, revID := uuid.New(), uuid.New()
	body, _ := json.Marshal(map[string]any{
		"id": newID, "reversal_entry_id": revID,
		"kind": "expense", "payer_id": yuto, "requested_by": memA, "total_amount": 9000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, memA},
		"occurred_on":  "2026-07-05",
	})
	req, _ := http.NewRequest("PUT",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s", gID, entryID), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", uuid.New().String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusCreated {
		rb, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d, body %s", resp.StatusCode, rb)
	}

	rows, err := s.Pool.Query(context.Background(),
		`SELECT id, created_by FROM entries WHERE id = $1 OR id = $2`, newID, revID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	byID := map[uuid.UUID]uuid.UUID{}
	for rows.Next() {
		var id, createdBy uuid.UUID
		if err := rows.Scan(&id, &createdBy); err != nil {
			t.Fatal(err)
		}
		byID[id] = createdBy
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if got := byID[newID]; got != memA {
		t.Fatalf("replacement created_by = %s, want requester %s (payer is %s)", got, memA, yuto)
	}
	if got := byID[revID]; got != memA {
		t.Fatalf("reversal created_by = %s, want requester %s (payer is %s)", got, memA, yuto)
	}
}

// Same backdoor as create's: an outsider named as requested_by must not
// bypass group membership just because they're not the payer or a participant.
func TestEdit_Endpoint_NonMemberRequesterIs422(t *testing.T) {
	srv, _ := newTestServer(t)
	entryID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(entryID))
	outsider := uuid.New()

	body, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "reversal_entry_id": uuid.New(),
		"kind": "expense", "payer_id": yuto, "requested_by": outsider, "total_amount": 9000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, memA},
		"occurred_on":  "2026-07-05",
	})
	req, _ := http.NewRequest("PUT",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s", gID, entryID), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", uuid.New().String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnprocessableEntity {
		rb, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d, body %s, want 422", resp.StatusCode, rb)
	}
}

func TestEdit_Endpoint_MissingRequestedByIs400(t *testing.T) {
	srv, _ := newTestServer(t)
	entryID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(entryID))

	body, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "reversal_entry_id": uuid.New(),
		"kind": "expense", "payer_id": yuto, "total_amount": 9000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, memA},
		"occurred_on":  "2026-07-05",
	})
	req, _ := http.NewRequest("PUT",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s", gID, entryID), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", uuid.New().String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		rb, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d, body %s, want 400", resp.StatusCode, rb)
	}
}

// The two correction endpoints hand back different pointers, and the names are
// deliberately not interchangeable: a reversal names the entry it retires
// (reverses_id), while an edit's replacement names the reversal that retired
// the original (reversal_entry_id). A client cannot tell them apart by type —
// both are UUID strings — so the wire names are the only thing distinguishing
// them, and nothing else in the suite pins them.
func TestCorrectionAcks_FieldNames(t *testing.T) {
	srv, _ := newTestServer(t)

	reversed := uuid.New()
	post(t, srv, uuid.New(), expenseBody(reversed))
	resp, body := postReverse(t, srv, uuid.New(), reversed, uuid.New())
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("reverse: status %d, body %s", resp.StatusCode, body)
	}
	assertAckKeys(t, "reverse", body, "id", "seq", "reverses_id")

	edited := uuid.New()
	post(t, srv, uuid.New(), expenseBody(edited))
	editBody, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "reversal_entry_id": uuid.New(),
		"kind": "expense", "payer_id": yuto, "requested_by": yuto, "total_amount": 9000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, memA},
		"occurred_on":  "2026-07-05",
	})
	req, _ := http.NewRequest("PUT",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s", gID, edited), bytes.NewReader(editBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", uuid.New().String())
	editResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = editResp.Body.Close() }()
	rb, _ := io.ReadAll(editResp.Body)
	if editResp.StatusCode != http.StatusCreated {
		t.Fatalf("edit: status %d, body %s", editResp.StatusCode, rb)
	}
	assertAckKeys(t, "edit", rb, "id", "seq", "reversal_entry_id")
}

func assertAckKeys(t *testing.T, label string, body []byte, want ...string) {
	t.Helper()
	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("%s ack: body %s: %v", label, body, err)
	}
	keys := make([]string, 0, len(got))
	for k := range got {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	sorted := append([]string(nil), want...)
	sort.Strings(sorted)
	if !slices.Equal(keys, sorted) {
		t.Fatalf("%s ack keys %v, want exactly %v", label, keys, sorted)
	}
}
