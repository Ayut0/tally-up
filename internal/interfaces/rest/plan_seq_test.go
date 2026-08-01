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

// settlementBody builds a settlement from memA to yuto, optionally carrying
// the plan_seq it was computed against.
func settlementBody(entryID uuid.UUID, amount int64, seq *int64) []byte {
	body := map[string]any{
		"id": entryID, "kind": "settlement", "payer_id": memA,
		"counterparty": yuto, "total_amount": amount,
		"occurred_on": "2026-07-05",
	}
	if seq != nil {
		body["plan_seq"] = *seq
	}
	b, _ := json.Marshal(body)
	return b
}

// planSeq reads GET /settle-plan (the endpoint #121 added) and returns the
// as_of_seq a client would carry back on the settlement it records.
func planSeq(t *testing.T, srv *httptest.Server) int64 {
	t.Helper()
	var plan struct {
		AsOfSeq int64 `json:"as_of_seq"`
	}
	resp := getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/settle-plan", gID), &plan)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("settle-plan status %d", resp.StatusCode)
	}
	return plan.AsOfSeq
}

func TestCreateSettlement_FreshPlanSeq_Accepted(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New())) // yuto +8000, memA/memB -4000

	seq := planSeq(t, srv)
	resp, body := post(t, srv, uuid.New(), settlementBody(uuid.New(), 4000, &seq))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s, want 201", resp.StatusCode, body)
	}
}

// TestCreateSettlement_StalePlanSeq_409WithRecomputedPlan is the whole point
// of #122: an expense lands between propose and record, so the plan the
// client holds no longer settles the group and must be replaced rather than
// applied.
func TestCreateSettlement_StalePlanSeq_409WithRecomputedPlan(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New()))

	stale := planSeq(t, srv)
	post(t, srv, uuid.New(), expenseBody(uuid.New())) // someone else spends
	moved := planSeq(t, srv)

	resp, body := post(t, srv, uuid.New(), settlementBody(uuid.New(), 4000, &stale))
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status %d, body %s, want 409", resp.StatusCode, body)
	}

	var got struct {
		Error string `json:"error"`
		Plan  struct {
			Transfers []struct {
				From   uuid.UUID `json:"from"`
				To     uuid.UUID `json:"to"`
				Amount int64     `json:"amount"`
			} `json:"transfers"`
			AsOfSeq int64 `json:"as_of_seq"`
		} `json:"plan"`
	}
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("unmarshal %s: %v", body, err)
	}
	// The literal string is what distinguishes this from the retryable
	// in-flight-idempotency 409 that shares the status code.
	if got.Error != "plan stale" {
		t.Fatalf("error = %q, want %q", got.Error, "plan stale")
	}
	if got.Plan.AsOfSeq != moved {
		t.Fatalf("recomputed plan as_of_seq = %d, want the current %d", got.Plan.AsOfSeq, moved)
	}
	if len(got.Plan.Transfers) == 0 {
		t.Fatal("409 carried no transfers; the client has nothing to adopt")
	}

	// The rejected settlement left no trace.
	if after := planSeq(t, srv); after != moved {
		t.Fatalf("ledger moved to %d after a rejected write, want %d", after, moved)
	}
}

// TestCreateSettlement_RecomputedPlanIsUsable closes the loop the 409 exists
// for: adopting the returned plan and re-submitting succeeds.
func TestCreateSettlement_RecomputedPlanIsUsable(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New()))
	stale := planSeq(t, srv)
	post(t, srv, uuid.New(), expenseBody(uuid.New()))

	_, body := post(t, srv, uuid.New(), settlementBody(uuid.New(), 4000, &stale))
	var got struct {
		Plan struct {
			AsOfSeq int64 `json:"as_of_seq"`
		} `json:"plan"`
	}
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}

	// A fresh Idempotency-Key is required: the retry's payload differs, and
	// reusing the original key would be a mismatch (422), not a write.
	resp, body := post(t, srv, uuid.New(), settlementBody(uuid.New(), 4000, &got.Plan.AsOfSeq))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("adopting the recomputed plan gave %d, body %s, want 201", resp.StatusCode, body)
	}
}

func TestCreateSettlement_NoPlanSeq_AlwaysAccepted(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New()))
	post(t, srv, uuid.New(), expenseBody(uuid.New())) // ledger moves

	resp, body := post(t, srv, uuid.New(), settlementBody(uuid.New(), 1000, nil))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s, want 201 for an off-plan settlement", resp.StatusCode, body)
	}
}

// TestEditSettlement_UnaffectedByPlanChecking pins issue #122 decision 6: a
// correction is not a new payment, so it never inherits a plan precondition —
// even when the settlement it replaces was originally recorded against one,
// and even though the ledger has moved well past that plan since.
func TestEditSettlement_UnaffectedByPlanChecking(t *testing.T) {
	srv, _ := newTestServer(t)
	post(t, srv, uuid.New(), expenseBody(uuid.New()))

	seq := planSeq(t, srv)
	settlementID := uuid.New()
	if resp, body := post(t, srv, uuid.New(), settlementBody(settlementID, 4000, &seq)); resp.StatusCode != http.StatusCreated {
		t.Fatalf("seed settlement: status %d, body %s", resp.StatusCode, body)
	}
	post(t, srv, uuid.New(), expenseBody(uuid.New())) // ledger moves past the plan

	body, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "reversal_entry_id": uuid.New(),
		"kind": "settlement", "payer_id": memA, "counterparty": yuto,
		"total_amount": 3000, "occurred_on": "2026-07-05",
	})
	req, _ := http.NewRequest("PUT",
		srv.URL+fmt.Sprintf("/groups/%s/entries/%s", gID, settlementID), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", uuid.New().String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusCreated {
		got, _ := io.ReadAll(resp.Body)
		t.Fatalf("edit status %d, body %s, want 201", resp.StatusCode, got)
	}
}

// TestCreateSettlement_UnknownGroup_SameStatusWithOrWithoutPlanSeq pins that
// carrying a plan_seq cannot change how a bad group_id is reported. The
// lock-free path reaches insertEntryAndPostings' membership check and returns
// 422; the plan-checked path takes the group-row lock first, and must
// translate its empty result the same way rather than surfacing a raw driver
// error as a 500.
func TestCreateSettlement_UnknownGroup_SameStatusWithOrWithoutPlanSeq(t *testing.T) {
	srv, _ := newTestServer(t)
	unknown := uuid.New()
	seq := int64(0)

	postTo := func(body []byte) int {
		t.Helper()
		req, _ := http.NewRequest("POST",
			srv.URL+fmt.Sprintf("/groups/%s/entries", unknown), bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", uuid.New().String())
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		return resp.StatusCode
	}

	withoutPlan := postTo(settlementBody(uuid.New(), 4000, nil))
	withPlan := postTo(settlementBody(uuid.New(), 4000, &seq))

	if withoutPlan != http.StatusUnprocessableEntity {
		t.Fatalf("without plan_seq: status %d, want 422", withoutPlan)
	}
	if withPlan != withoutPlan {
		t.Fatalf("plan_seq changed the reported status for an unknown group: %d with, %d without",
			withPlan, withoutPlan)
	}
}

func TestCreateExpense_WithPlanSeq_422(t *testing.T) {
	srv, _ := newTestServer(t)

	var req map[string]any
	if err := json.Unmarshal(expenseBody(uuid.New()), &req); err != nil {
		t.Fatal(err)
	}
	req["plan_seq"] = 0
	body, _ := json.Marshal(req)

	resp, respBody := post(t, srv, uuid.New(), body)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, body %s, want 422", resp.StatusCode, respBody)
	}
}
