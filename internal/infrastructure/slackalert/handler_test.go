package slackalert_test

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"tallyup/internal/infrastructure/slackalert"
)

// recordingHandler is a minimal slog.Handler that captures every record
// handed to it, so tests can assert the wrapper always forwards to next
// regardless of what it does with Slack.
type recordingHandler struct {
	mu      sync.Mutex
	records []slog.Record
}

func (h *recordingHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h *recordingHandler) Handle(_ context.Context, r slog.Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.records = append(h.records, r)
	return nil
}

func (h *recordingHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *recordingHandler) WithGroup(string) slog.Handler      { return h }

func (h *recordingHandler) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.records)
}

// fakeNotifier records every Notify call onto a channel so tests can wait
// for the handler's async worker without sleeping.
type fakeNotifier struct {
	calls chan string
	block chan struct{} // when non-nil, Notify waits on it (or ctx) before returning
}

func newFakeNotifier() *fakeNotifier {
	return &fakeNotifier{calls: make(chan string, 64)}
}

func (f *fakeNotifier) Notify(ctx context.Context, text string) error {
	if f.block != nil {
		select {
		case <-f.block:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	f.calls <- text
	return nil
}

func newRecord(level slog.Level, msg string, attrs ...slog.Attr) slog.Record {
	r := slog.NewRecord(time.Now(), level, msg, 0)
	r.AddAttrs(attrs...)
	return r
}

func TestHandler_AlwaysForwardsToNext(t *testing.T) {
	next := &recordingHandler{}
	notifier := newFakeNotifier()
	ctx := t.Context()

	h := slackalert.NewHandler(ctx, next, notifier)

	if err := h.Handle(ctx, newRecord(slog.LevelInfo, "just info")); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if err := h.Handle(ctx, newRecord(slog.LevelError, "boom")); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if got := next.count(); got != 2 {
		t.Errorf("next handler saw %d records, want 2", got)
	}
}

func TestHandler_ErrorLevelNotifiesSlack(t *testing.T) {
	next := &recordingHandler{}
	notifier := newFakeNotifier()
	ctx := t.Context()

	h := slackalert.NewHandler(ctx, next, notifier)

	if err := h.Handle(ctx, newRecord(slog.LevelError, "db unreachable", slog.String("err", "timeout"))); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	select {
	case text := <-notifier.calls:
		if !strings.Contains(text, "db unreachable") {
			t.Errorf("notified text = %q, want it to contain the message", text)
		}
		if !strings.Contains(text, "timeout") {
			t.Errorf("notified text = %q, want it to contain the attrs", text)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for Slack notification")
	}
}

func TestHandler_BelowErrorLevelDoesNotNotify(t *testing.T) {
	next := &recordingHandler{}
	notifier := newFakeNotifier()
	ctx := t.Context()

	h := slackalert.NewHandler(ctx, next, notifier)

	for _, level := range []slog.Level{slog.LevelDebug, slog.LevelInfo, slog.LevelWarn} {
		if err := h.Handle(ctx, newRecord(level, "not an error")); err != nil {
			t.Fatalf("Handle: %v", err)
		}
	}

	select {
	case text := <-notifier.calls:
		t.Fatalf("unexpected Slack notification for sub-error level: %q", text)
	case <-time.After(100 * time.Millisecond):
		// expected: no notification
	}
}

func TestHandler_HandleNeverBlocksWhenSlackIsSlow(t *testing.T) {
	next := &recordingHandler{}
	notifier := newFakeNotifier()
	notifier.block = make(chan struct{}) // Notify blocks until the test releases it
	ctx := t.Context()

	h := slackalert.NewHandler(ctx, next, notifier)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for range 64 {
			if err := h.Handle(ctx, newRecord(slog.LevelError, "flood")); err != nil {
				t.Errorf("Handle: %v", err)
				return
			}
		}
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Handle blocked on a slow/stuck Slack notifier instead of dropping")
	}
}

func TestHandler_FlushWaitsForPriorAlertToBeAttempted(t *testing.T) {
	next := &recordingHandler{}
	notifier := newFakeNotifier()
	ctx := t.Context()

	h := slackalert.NewHandler(ctx, next, notifier)

	if err := h.Handle(ctx, newRecord(slog.LevelError, "boot failed")); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	flushCtx, flushCancel := context.WithTimeout(ctx, 2*time.Second)
	defer flushCancel()
	h.Flush(flushCtx)

	select {
	case text := <-notifier.calls:
		if !strings.Contains(text, "boot failed") {
			t.Errorf("notified text = %q, want it to contain the message", text)
		}
	default:
		t.Fatal("Flush returned before the queued alert was attempted")
	}
}

func TestHandler_FlushReturnsOnContextDoneRatherThanHanging(t *testing.T) {
	next := &recordingHandler{}
	notifier := newFakeNotifier()
	notifier.block = make(chan struct{}) // Notify never returns on its own
	ctx := t.Context()

	h := slackalert.NewHandler(ctx, next, notifier)
	if err := h.Handle(ctx, newRecord(slog.LevelError, "stuck")); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	flushCtx, flushCancel := context.WithTimeout(ctx, 200*time.Millisecond)
	defer flushCancel()

	done := make(chan struct{})
	go func() {
		defer close(done)
		h.Flush(flushCtx)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Flush hung instead of returning when its context timed out")
	}
}

func TestWebhookNotifier_ImplementsNotifier(t *testing.T) {
	var _ slackalert.Notifier = (*slackalert.WebhookNotifier)(nil)
}
