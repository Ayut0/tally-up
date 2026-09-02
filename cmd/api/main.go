package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tallyup/internal/application/addentry"
	"tallyup/internal/application/addmember"
	"tallyup/internal/application/correctentry"
	"tallyup/internal/application/creategroup"
	"tallyup/internal/application/proposesettleplan"
	"tallyup/internal/infrastructure/postgres"
	"tallyup/internal/infrastructure/slackalert"
	"tallyup/internal/interfaces/rest"
)

func main() {
	os.Exit(mainWithExitCode())
}

// mainWithExitCode holds everything main would otherwise do directly: an
// os.Exit call in main itself would skip any pending defer (notably
// cancelAlerts below), so main just relays the exit code this returns.
func mainWithExitCode() int {
	// A dedicated context, independent of run()'s signal-bound one, so the
	// worker survives long enough to send an alert about run() itself
	// failing (e.g. a missing DATABASE_URL at boot).
	alertCtx, cancelAlerts := context.WithCancel(context.Background())
	defer cancelAlerts()

	var alerts *slackalert.Handler
	if webhookURL := os.Getenv("SLACK_WEBHOOK_URL"); webhookURL != "" {
		alerts = slackalert.NewHandler(alertCtx, slog.Default().Handler(), &slackalert.WebhookNotifier{URL: webhookURL})
		slog.SetDefault(slog.New(alerts))
	}

	err := run()
	if err != nil {
		slog.Error("fatal", "err", err)
	}
	if alerts != nil {
		flushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		alerts.Flush(flushCtx)
		cancel()
	}
	if err != nil {
		return 1
	}
	return 0
}

// run holds everything that used to live in main directly. Splitting it out
// means an early failure returns an error instead of calling os.Exit itself,
// so every defer above the failure point (notably signal.NotifyContext's
// stop and the pool close) still runs.
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return errors.New("DATABASE_URL required")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	s, err := postgres.New(ctx, dbURL)
	if err != nil {
		return fmt.Errorf("postgres init: %w", err)
	}
	defer s.Pool.Close()

	// Idempotency janitor: expire stale pending keys so crashed writes can retry.
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if n, err := s.Idempotency.SweepStalePending(ctx, time.Minute); err != nil {
					slog.Warn("janitor sweep", "err", err)
				} else if n > 0 {
					slog.Info("janitor swept stale pending keys", "count", n)
				}
			}
		}
	}()

	entries := &addentry.Service{Gate: s.Idempotency, Entries: s.Entries}
	corrections := &correctentry.Service{Gate: s.Idempotency, Reverses: s.Entries, Edits: s.Entries}
	groups := &creategroup.Service{Gate: s.Idempotency, Groups: s.Groups}
	settlePlans := &proposesettleplan.Service{Balances: s.Reads}
	addMember := &addmember.Service{Gate: s.Idempotency, Members: s.Groups}
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           rest.NewServer(entries, s.Reads, s.Reads, s.Reads, corrections, groups, s.Groups, settlePlans, addMember, s.Groups, os.Getenv("CORS_ORIGIN")),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil { // drains in-flight requests/transactions
			slog.Warn("graceful shutdown", "err", err)
		}
	}()

	slog.Info("tallyup api listening", "port", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("server: %w", err)
	}
	return nil
}
