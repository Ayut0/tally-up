package rest

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func getJSON(t *testing.T, url string, out any) *http.Response {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(body, out); err != nil {
		t.Fatalf("unmarshal %s: %v", body, err)
	}
	return resp
}

func TestGetBalance_Endpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New())) // yuto pays 12000 / 3-way

	var snap struct {
		Balances []struct {
			MemberID uuid.UUID `json:"member_id"`
			Balance  int64     `json:"balance"`
		} `json:"balances"`
		AsOfSeq int64 `json:"as_of_seq"`
	}
	resp := getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/balance", gID), &snap)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if len(snap.Balances) != 3 || snap.Balances[0].Balance != 8000 {
		t.Fatalf("unexpected snapshot: %+v", snap)
	}
	if snap.AsOfSeq < 1 {
		t.Fatalf("as_of_seq = %d, want >= 1", snap.AsOfSeq)
	}
}

func TestGetSettlePlan_Endpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New())) // yuto pays 12000 / 3-way equal split

	var plan struct {
		Transfers []struct {
			From   uuid.UUID `json:"from"`
			To     uuid.UUID `json:"to"`
			Amount int64     `json:"amount"`
		} `json:"transfers"`
		AsOfSeq int64 `json:"as_of_seq"`
	}
	resp := getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/settle-plan", gID), &plan)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if plan.AsOfSeq < 1 {
		t.Fatalf("as_of_seq = %d, want >= 1", plan.AsOfSeq)
	}

	// yuto is owed 8000 by memA and memB (4000 each, tied): both debts route
	// to yuto, ties broken by ascending member UUID (memA < memB).
	if len(plan.Transfers) != 2 {
		t.Fatalf("got %d transfers, want 2: %+v", len(plan.Transfers), plan.Transfers)
	}
	if plan.Transfers[0].From != memA || plan.Transfers[0].To != yuto || plan.Transfers[0].Amount != 4000 {
		t.Fatalf("transfer[0] = %+v, want memA -> yuto 4000", plan.Transfers[0])
	}
	if plan.Transfers[1].From != memB || plan.Transfers[1].To != yuto || plan.Transfers[1].Amount != 4000 {
		t.Fatalf("transfer[1] = %+v, want memB -> yuto 4000", plan.Transfers[1])
	}
}

func TestGetSettlePlan_EmptyGroup(t *testing.T) {
	srv, _ := newTestServer(t)

	var plan struct {
		Transfers []struct{} `json:"transfers"`
		AsOfSeq   int64      `json:"as_of_seq"`
	}
	resp := getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/settle-plan", gID), &plan)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if len(plan.Transfers) != 0 || plan.AsOfSeq != 0 {
		t.Fatalf("got %+v, want empty transfers and as_of_seq 0", plan)
	}
}

func TestListEntries_Endpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New()))
	post(t, srv, uuid.New(), expenseBody(uuid.New()))

	var page struct {
		Entries []struct {
			Seq      int64 `json:"seq"`
			Postings []struct {
				Amount int64 `json:"amount"`
			} `json:"postings"`
		} `json:"entries"`
	}
	resp := getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/entries?after_seq=0", gID), &page)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if len(page.Entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(page.Entries))
	}
	if len(page.Entries[0].Postings) != 3 {
		t.Fatalf("postings missing: %+v", page.Entries[0])
	}

	resp = getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/entries?after_seq=%d", gID, page.Entries[0].Seq), &page)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("incremental fetch status %d", resp.StatusCode)
	}
	if len(page.Entries) != 1 {
		t.Fatalf("incremental fetch got %d entries, want 1", len(page.Entries))
	}
}

// TestListEntries_SplitRuleOmittedForSettlementAndReversal covers #160:
// settlement and reversal entries store a placeholder split_rule
// ({"type":"settlement"} / {"type":"reversal"}) that isn't a member of the
// SplitRule union, so echoing it verbatim in the list response fails
// validatingHandler's OpenAPI check. The fix is to omit split_rule
// entirely for those two kinds rather than invent union variants for a
// placeholder.
func TestListEntries_SplitRuleOmittedForSettlementAndReversal(t *testing.T) {
	srv, _ := newTestServer(t)
	expenseID := uuid.New()
	post(t, srv, uuid.New(), expenseBody(expenseID))

	settlement, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "kind": "settlement", "payer_id": memA, "requested_by": memA,
		"counterparty": yuto, "total_amount": 4000, "occurred_on": "2026-07-05",
	})
	post(t, srv, uuid.New(), settlement)

	postReverse(t, srv, uuid.New(), expenseID, uuid.New())

	var page struct {
		Entries []struct {
			Kind      string          `json:"kind"`
			SplitRule json.RawMessage `json:"split_rule"`
		} `json:"entries"`
	}
	resp := getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/entries?after_seq=0", gID), &page)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d (want 200 — a settlement or reversal entry in the response must still pass OpenAPI validation)", resp.StatusCode)
	}
	if len(page.Entries) != 3 {
		t.Fatalf("got %d entries, want 3: %+v", len(page.Entries), page.Entries)
	}
	for _, e := range page.Entries {
		hasSplitRule := len(e.SplitRule) > 0
		wantSplitRule := e.Kind == "expense"
		if hasSplitRule != wantSplitRule {
			t.Errorf("kind %s: split_rule present = %v, want %v (raw: %s)", e.Kind, hasSplitRule, wantSplitRule, e.SplitRule)
		}
	}
}
