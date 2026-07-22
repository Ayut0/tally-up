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
	defer resp.Body.Close()
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
	if len(page.Entries) != 1 {
		t.Fatalf("incremental fetch got %d entries, want 1", len(page.Entries))
	}
}
