// Package notify posts run summaries to Slack. With no webhook set it does nothing.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/ledger"
)

type Slack struct {
	WebhookURL string
	Client     *http.Client
}

func (s *Slack) Send(ctx context.Context, text string) error {
	if s == nil || s.WebhookURL == "" {
		return nil
	}
	body, _ := json.Marshal(map[string]string{"text": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	c := s.Client
	if c == nil {
		c = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("slack webhook returned %s", resp.Status)
	}
	return nil
}

// Summary renders a weekly run for Slack. Bucket names stay out of the message: the
// channel is wider than the VPN.
func Summary(runs []ledger.Run, runErr error) string {
	var b strings.Builder
	var copied, deleted, failed, copiedBytes, deletedBytes int64
	for _, r := range runs {
		copied += r.Copied
		deleted += r.Deleted
		failed += r.Failed
		copiedBytes += r.CopiedBytes
		deletedBytes += r.DeletedBytes
	}
	status := "done"
	if runErr != nil || failed > 0 {
		status = "needs attention"
	}
	fmt.Fprintf(&b, "Storage archive weekly run: %s. %d buckets; copied %d objects (%s); freed %d objects (%s) on S3",
		status, len(runs), copied, Bytes(copiedBytes), deleted, Bytes(deletedBytes))
	if failed > 0 {
		fmt.Fprintf(&b, "; %d failed", failed)
	}
	b.WriteString(".")
	if runErr != nil {
		b.WriteString(" A run ended with an error; details are in the archiver UI.")
	}
	return b.String()
}

// Bytes formats a size in binary units.
func Bytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(n)/float64(div), "KMGTPE"[exp])
}
