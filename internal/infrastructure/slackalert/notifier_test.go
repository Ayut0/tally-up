package slackalert_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tallyup/internal/infrastructure/slackalert"
)

func TestWebhookNotifier_Notify_PostsSlackPayload(t *testing.T) {
	var gotMethod, gotContentType string
	var gotBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotContentType = r.Header.Get("Content-Type")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	n := &slackalert.WebhookNotifier{URL: srv.URL}
	if err := n.Notify(context.Background(), "boom"); err != nil {
		t.Fatalf("Notify: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if !strings.HasPrefix(gotContentType, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", gotContentType)
	}
	if gotBody["text"] != "boom" {
		t.Errorf("posted text = %q, want %q", gotBody["text"], "boom")
	}
}

func TestWebhookNotifier_Notify_NonOKStatusIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	n := &slackalert.WebhookNotifier{URL: srv.URL}
	if err := n.Notify(context.Background(), "boom"); err == nil {
		t.Fatal("Notify: want error on non-2xx status, got nil")
	}
}

func TestWebhookNotifier_Notify_RespectsContextCancellation(t *testing.T) {
	n := &slackalert.WebhookNotifier{URL: "http://127.0.0.1:0"}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := n.Notify(ctx, "boom"); err == nil {
		t.Fatal("Notify: want error for a cancelled context, got nil")
	}
}
