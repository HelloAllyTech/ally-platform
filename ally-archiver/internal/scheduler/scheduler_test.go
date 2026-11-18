package scheduler

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/fake"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/ledger"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/mover"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/notify"
)

func TestTickRunsArmedBucketsAndPostsSummary(t *testing.T) {
	ctx := context.Background()
	l, err := ledger.Open(filepath.Join(t.TempDir(), "l.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	l.SyncBuckets(ctx, []string{"armed-bucket", "idle-bucket"})
	l.SetBucket(ctx, "armed-bucket", "enabled", true)
	l.SetBucket(ctx, "armed-bucket", "armed", true)
	l.SetBucket(ctx, "idle-bucket", "enabled", true)

	src, bx := fake.NewSource(), fake.NewBox()
	old := time.Now().Add(-40 * 24 * time.Hour)
	src.Add("armed-bucket", "a", []byte("1234"), old)
	src.Add("idle-bucket", "b", []byte("5678"), old)

	var posted []string
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var m map[string]string
		json.NewDecoder(r.Body).Decode(&m)
		posted = append(posted, m["text"])
	}))
	defer hook.Close()

	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	m := &mover.Mover{Ledger: l, Source: src, OpenBox: bx.Open, Root: "r", MinAge: 30 * 24 * time.Hour, Workers: 1, Log: quiet}
	s := &Scheduler{Ledger: l, Runner: &mover.Runner{M: m}, Slack: &notify.Slack{WebhookURL: hook.URL}, Log: quiet}

	s.SetPaused(ctx, true)
	s.Tick(ctx)
	if runs, _ := l.Runs(ctx, 10); len(runs) != 0 {
		t.Fatal("a paused schedule must not run")
	}

	s.SetPaused(ctx, false)
	s.Tick(ctx)
	runs, _ := l.Runs(ctx, 10)
	if len(runs) != 1 || runs[0].Bucket != "armed-bucket" || runs[0].Copied != 1 {
		t.Fatalf("runs = %+v", runs)
	}
	if _, ok := bx.File("r/idle-bucket/b"); ok {
		t.Fatal("an unarmed bucket must not be copied")
	}
	if len(posted) != 1 || !strings.Contains(posted[0], "copied 1 objects") || strings.Contains(posted[0], "armed-bucket") {
		t.Fatalf("slack = %q", posted)
	}
}

func TestStartRejectsBadSpec(t *testing.T) {
	s := &Scheduler{}
	if err := s.Start("not a cron spec"); err == nil {
		t.Fatal("want error")
	}
}
