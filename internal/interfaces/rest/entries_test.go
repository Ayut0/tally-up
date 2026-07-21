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

	"tallyup/internal/application/addentry"
	"tallyup/internal/domain/ledger"
	"tallyup/internal/infrastructure/postgres"
)

var (
	gID  = uuid.MustParse("00000000-0000-0000-0000-0000000000a1")
	yuto = uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	memA = uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	memB = uuid.MustParse("00000000-0000-0000-0000-00000000000c")
)

// seedGroup inserts the standard 3-member test group.
// One statement per Exec: pgx v5's extended protocol rejects multi-statement
// calls, and bind parameters can never span statements anyway.
func seedGroup(t *testing.T, s *postgres.Store) {
	t.Helper()
	ctx := context.Background()
	stmts := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO members (id, name) VALUES ($1,'yuto'), ($2,'a'), ($3,'b')`, []any{yuto, memA, memB}},
		{`INSERT INTO groups (id, name) VALUES ($1, 'trip')`, []any{gID}},
		{`INSERT INTO group_members (group_id, member_id) VALUES ($1,$2), ($1,$3), ($1,$4)`, []any{gID, yuto, memA, memB}},
	}
	for _, st := range stmts {
		if _, err := s.Pool.Exec(ctx, st.sql, st.args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
}

func expenseBody(entryID uuid.UUID) []byte {
	b, _ := json.Marshal(map[string]any{
		"id": entryID, "kind": "expense", "payer_id": yuto,
		"total_amount": 12000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, memA, memB},
		"memo":         "dinner", "occurred_on": "2026-07-05",
	})
	return b
}

func post(t *testing.T, srv *httptest.Server, key uuid.UUID, body []byte) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest("POST", srv.URL+fmt.Sprintf("/groups/%s/entries", gID), bytes.NewReader(body))
	req.Header.Set("Idempotency-Key", key.String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	return resp, rb
}

func newTestServer(t *testing.T) (*httptest.Server, *postgres.Store) {
	s := postgres.TestStore(t)
	seedGroup(t, s)
	svc := &addentry.Service{Gate: s, Entries: s}
	srv := httptest.NewServer(NewServer(svc, s))
	t.Cleanup(srv.Close)
	return srv, s
}

func TestCreateExpense_HappyPath(t *testing.T) {
	srv, s := newTestServer(t)
	resp, body := post(t, srv, uuid.New(), expenseBody(uuid.New()))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s", resp.StatusCode, body)
	}
	var sum int64
	if err := s.Pool.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(amount),0) FROM postings`).Scan(&sum); err != nil {
		t.Fatal(err)
	}
	if sum != 0 {
		t.Fatalf("postings sum %d, want 0", sum)
	}
	var n int
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d entries, want 1", n)
	}
}

func TestCreateExpense_ReplaySameKeySameBody(t *testing.T) {
	srv, s := newTestServer(t)
	key, body := uuid.New(), expenseBody(uuid.New())
	resp1, body1 := post(t, srv, key, body)
	resp2, body2 := post(t, srv, key, body)
	if resp1.StatusCode != http.StatusCreated || resp2.StatusCode != http.StatusOK {
		t.Fatalf("statuses %d/%d, want 201/200", resp1.StatusCode, resp2.StatusCode)
	}
	if !bytes.Equal(body1, body2) {
		t.Fatalf("replay body differs: %s vs %s", body1, body2)
	}
	var n int
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d entries after replay, want 1", n)
	}
}

func TestCreateExpense_SameKeyDifferentBodyIs422(t *testing.T) {
	srv, _ := newTestServer(t)
	key := uuid.New()
	post(t, srv, key, expenseBody(uuid.New()))
	resp, _ := post(t, srv, key, expenseBody(uuid.New())) // different entry id → different bytes
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422", resp.StatusCode)
	}
}

func TestCreateExpense_NonMemberParticipantIs422(t *testing.T) {
	srv, _ := newTestServer(t)
	outsider := uuid.New()
	b, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "kind": "expense", "payer_id": yuto,
		"total_amount": 1000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, outsider},
		"occurred_on":  "2026-07-05",
	})
	resp, _ := post(t, srv, uuid.New(), b)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422", resp.StatusCode)
	}
}

// TestCreateExpense_WeightedSharesRoundTrip proves a non-equal split_rule
// actually survives HTTP -> JSON -> Postgres JSONB -> read-back, and that the
// stored postings reflect the weighted split rather than an equal one.
func TestCreateExpense_WeightedSharesRoundTrip(t *testing.T) {
	srv, s := newTestServer(t)
	ctx := context.Background()

	entryID := uuid.New()
	weights := map[uuid.UUID]int64{yuto: 2, memA: 1, memB: 1} // 12000 total -> 6000/3000/3000, no rounding
	body, _ := json.Marshal(map[string]any{
		"id": entryID, "kind": "expense", "payer_id": yuto,
		"total_amount": 12000,
		"split_rule": map[string]any{
			"type":    "shares",
			"weights": weights,
		},
		"participants": []uuid.UUID{yuto, memA, memB},
		"memo":         "weighted dinner", "occurred_on": "2026-07-05",
	})

	resp, respBody := post(t, srv, uuid.New(), body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s", resp.StatusCode, respBody)
	}

	// Read back split_rule straight from Postgres and confirm it deserializes
	// into the same weighted shares rule that was posted.
	var splitRuleJSON []byte
	if err := s.Pool.QueryRow(ctx,
		`SELECT split_rule FROM entries WHERE id = $1`, entryID).Scan(&splitRuleJSON); err != nil {
		t.Fatalf("read split_rule: %v", err)
	}
	var gotRule ledger.SplitRule
	if err := json.Unmarshal(splitRuleJSON, &gotRule); err != nil {
		t.Fatalf("unmarshal split_rule: %v (raw %s)", err, splitRuleJSON)
	}
	if gotRule.Type != ledger.SplitShares {
		t.Fatalf("split_rule type %q, want %q", gotRule.Type, ledger.SplitShares)
	}
	if len(gotRule.Weights) != len(weights) {
		t.Fatalf("split_rule weights %v, want %v", gotRule.Weights, weights)
	}
	for member, want := range weights {
		if got := gotRule.Weights[member]; got != want {
			t.Fatalf("split_rule weight for %s = %d, want %d", member, got, want)
		}
	}

	// Confirm the postings actually reflect the 2:1:1 weighted split, not an
	// equal 4000/4000/4000 fallback.
	rows, err := s.Pool.Query(ctx,
		`SELECT member_id, amount FROM postings WHERE entry_id = $1`, entryID)
	if err != nil {
		t.Fatalf("query postings: %v", err)
	}
	defer rows.Close()
	got := map[uuid.UUID]int64{}
	for rows.Next() {
		var member uuid.UUID
		var amount int64
		if err := rows.Scan(&member, &amount); err != nil {
			t.Fatalf("scan posting: %v", err)
		}
		got[member] = amount
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	want := map[uuid.UUID]int64{yuto: 6000, memA: -3000, memB: -3000}
	if len(got) != len(want) {
		t.Fatalf("postings %v, want %v", got, want)
	}
	for member, amt := range want {
		if got[member] != amt {
			t.Fatalf("posting for %s = %d, want %d (all: %v)", member, got[member], amt, got)
		}
	}
}

func TestCreateSettlement(t *testing.T) {
	srv, s := newTestServer(t)
	b, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "kind": "settlement", "payer_id": memA,
		"counterparty": yuto, "total_amount": 4000, "occurred_on": "2026-07-05",
	})
	resp, body := post(t, srv, uuid.New(), b)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s", resp.StatusCode, body)
	}
	var amt int64
	err := s.Pool.QueryRow(context.Background(),
		`SELECT amount FROM postings WHERE member_id=$1`, memA).Scan(&amt)
	if err != nil || amt != 4000 {
		t.Fatalf("payer posting %d (err %v), want +4000", amt, err)
	}
}

func TestPostGateFailureReleasesKey_RetryProceeds(t *testing.T) {
	srv, _ := newTestServer(t)
	key := uuid.New()
	outsider := uuid.New()
	bad, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "kind": "expense", "payer_id": yuto,
		"total_amount": 1000,
		"split_rule":   map[string]any{"type": "equal"},
		"participants": []uuid.UUID{yuto, outsider},
		"occurred_on":  "2026-07-05",
	})
	resp, _ := post(t, srv, key, bad)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422", resp.StatusCode)
	}
	// The key was released, so a corrected request with the same key succeeds
	// immediately — no waiting for the janitor.
	resp, body := post(t, srv, key, expenseBody(uuid.New()))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("corrected retry: status %d, body %s", resp.StatusCode, body)
	}
}

func TestMissingIdempotencyKeyIs400(t *testing.T) {
	srv, _ := newTestServer(t)
	req, _ := http.NewRequest("POST", srv.URL+fmt.Sprintf("/groups/%s/entries", gID),
		bytes.NewReader(expenseBody(uuid.New())))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", resp.StatusCode)
	}
}

func TestConcurrency_SameKey50x_ExactlyOneEntry(t *testing.T) {
	srv, s := newTestServer(t)
	key, body := uuid.New(), expenseBody(uuid.New())

	const workers = 50
	statuses := make(chan int, workers)
	for i := 0; i < workers; i++ {
		go func() {
			resp, _ := post(t, srv, key, body)
			statuses <- resp.StatusCode
		}()
	}
	counts := map[int]int{}
	for i := 0; i < workers; i++ {
		counts[<-statuses]++
	}

	// Exactly one 201; everything else replayed (200) or bounced in-flight (409).
	if counts[201] != 1 {
		t.Fatalf("got %d 201s, want exactly 1 (all statuses: %v)", counts[201], counts)
	}
	if counts[201]+counts[200]+counts[409] != workers {
		t.Fatalf("unexpected statuses: %v", counts)
	}

	var n int
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d entries, want exactly 1", n)
	}

	// A 409 client retries and must eventually get the replay.
	resp, _ := post(t, srv, key, body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("retry after storm: status %d, want 200", resp.StatusCode)
	}
}

func TestConcurrency_DistinctKeys50x_AllLand(t *testing.T) {
	srv, s := newTestServer(t)

	const workers = 50
	done := make(chan struct{}, workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			resp, body := post(t, srv, uuid.New(), expenseBody(uuid.New()))
			if resp.StatusCode != http.StatusCreated {
				t.Errorf("status %d, body %s", resp.StatusCode, body)
			}
		}()
	}
	for i := 0; i < workers; i++ {
		<-done
	}

	var n int
	var sum int64
	s.Pool.QueryRow(context.Background(), `SELECT count(*) FROM entries`).Scan(&n)
	s.Pool.QueryRow(context.Background(), `SELECT COALESCE(SUM(amount),0) FROM postings`).Scan(&sum)
	if n != workers {
		t.Fatalf("%d entries, want %d", n, workers)
	}
	if sum != 0 {
		t.Fatalf("global postings sum %d, want 0", sum)
	}
}
