package slackalert

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"
)

// queueSize bounds how many pending alerts the background worker can hold.
// Handle drops a new alert rather than block the caller once it's full —
// losing a duplicate alert under a flood beats stalling the request path.
const queueSize = 64

const notifyTimeout = 5 * time.Second

// Handler wraps an slog.Handler and posts a Slack notification for every
// record at slog.LevelError or above, in addition to passing every record
// through to next unchanged. Delivery runs on a background goroutine so a
// slow or unreachable Slack webhook never blocks the caller.
type Handler struct {
	next     slog.Handler
	notifier Notifier
	queue    chan queueItem
}

// queueItem is either a real alert (text set) or a flush marker (done set):
// Flush relies on the channel's FIFO ordering, so a marker enqueued after
// some alerts is only processed once the worker has attempted all of them.
type queueItem struct {
	text string
	done chan<- struct{}
}

// NewHandler starts the background delivery worker, which runs until ctx is
// done.
func NewHandler(ctx context.Context, next slog.Handler, notifier Notifier) *Handler {
	h := &Handler{
		next:     next,
		notifier: notifier,
		queue:    make(chan queueItem, queueSize),
	}
	go h.run(ctx)
	return h
}

func (h *Handler) run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case item := <-h.queue:
			if item.done != nil {
				close(item.done)
				continue
			}
			notifyCtx, cancel := context.WithTimeout(ctx, notifyTimeout)
			if err := h.notifier.Notify(notifyCtx, item.text); err != nil {
				// Logged directly to stderr, bypassing this handler, so a
				// Slack outage can't recursively try to notify about itself.
				fmt.Fprintf(os.Stderr, "slackalert: notify failed: %v\n", err)
			}
			cancel()
		}
	}
}

// Flush blocks until every alert enqueued before this call has been
// attempted (or ctx is done), so a caller about to exit — e.g. after a
// fatal startup error — can be sure the alert had a chance to go out before
// the process ends and the background worker's context is cancelled.
func (h *Handler) Flush(ctx context.Context) {
	done := make(chan struct{})
	select {
	case h.queue <- queueItem{done: done}:
	case <-ctx.Done():
		return
	}
	select {
	case <-done:
	case <-ctx.Done():
	}
}

func (h *Handler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.next.Enabled(ctx, level)
}

func (h *Handler) Handle(ctx context.Context, r slog.Record) error {
	err := h.next.Handle(ctx, r)
	if r.Level >= slog.LevelError {
		select {
		case h.queue <- queueItem{text: formatRecord(r)}:
		default:
			fmt.Fprintln(os.Stderr, "slackalert: queue full, dropping alert")
		}
	}
	return err
}

func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &Handler{next: h.next.WithAttrs(attrs), notifier: h.notifier, queue: h.queue}
}

func (h *Handler) WithGroup(name string) slog.Handler {
	return &Handler{next: h.next.WithGroup(name), notifier: h.notifier, queue: h.queue}
}

func formatRecord(r slog.Record) string {
	var b strings.Builder
	b.WriteString(":rotating_light: ")
	b.WriteString(r.Message)
	r.Attrs(func(a slog.Attr) bool {
		fmt.Fprintf(&b, " %s=%v", a.Key, a.Value)
		return true
	})
	return b.String()
}
