package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tallyup/internal/api"
	"tallyup/internal/store"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		slog.Error("DATABASE_URL required")
		os.Exit(1)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	s, err := store.New(ctx, dbURL)
	if err != nil {
		slog.Error("store init", "err", err)
		os.Exit(1)
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
				if n, err := s.SweepStalePending(ctx, time.Minute); err != nil {
					slog.Warn("janitor sweep", "err", err)
				} else if n > 0 {
					slog.Info("janitor swept stale pending keys", "count", n)
				}
			}
		}
	}()

	srv := &http.Server{Addr: ":" + port, Handler: api.NewServer(s)}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx) // drains in-flight requests/transactions
	}()

	slog.Info("tallyup api listening", "port", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}
