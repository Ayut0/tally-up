// Package slackalert posts operational alerts to a Slack Incoming Webhook.
package slackalert

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// Notifier delivers a single alert message.
type Notifier interface {
	Notify(ctx context.Context, text string) error
}

// WebhookNotifier posts to a Slack Incoming Webhook URL
// (https://api.slack.com/messaging/webhooks).
type WebhookNotifier struct {
	URL string
	// Client defaults to http.DefaultClient when nil.
	Client *http.Client
}

func (w *WebhookNotifier) Notify(ctx context.Context, text string) error {
	body, err := json.Marshal(struct {
		Text string `json:"text"`
	}{Text: text})
	if err != nil {
		return fmt.Errorf("slackalert: marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("slackalert: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := w.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("slackalert: post webhook: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("slackalert: webhook returned status %d", resp.StatusCode)
	}
	return nil
}
