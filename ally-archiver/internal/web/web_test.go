package web

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/config"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/fake"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/ledger"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/mover"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/scheduler"
)

const password = "correct horse battery"

func setup(t *testing.T) (*httptest.Server, *ledger.Ledger, *fake.Source) {
	t.Helper()
	ctx := context.Background()
	l, err := ledger.Open(filepath.Join(t.TempDir(), "l.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	l.SyncBuckets(ctx, []string{"recordings-test"})
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	cfg := &config.Config{
		Buckets:           []config.Bucket{{Name: "recordings-test", Region: "test"}},
		MinAge:            30 * 24 * time.Hour,
		AdminPasswordHash: string(hash),
		EgressUSDPerGB:    0.09, S3USDPerGBMonth: 0.025,
		// Any values do: the mover uses the in-memory box below.
		BoxAddr: "box.test:23", BoxUser: "u", BoxKeyFile: "k", BoxKnownHosts: "kh",
	}
	src, bx := fake.NewSource(), fake.NewBox()
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	m := &mover.Mover{Ledger: l, Source: src, OpenBox: bx.Open, Root: "ally-archive", MinAge: cfg.MinAge, Workers: 1, Log: quiet}
	runner := &mover.Runner{M: m}
	srv := &Server{Cfg: cfg, Ledger: l, Mover: m, Runner: runner, Sched: &scheduler.Scheduler{Ledger: l, Runner: runner, Log: quiet}, Log: quiet}
	h, err := srv.Handler()
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(h)
	t.Cleanup(ts.Close)
	return ts, l, src
}

func client(t *testing.T) *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func login(t *testing.T, ts *httptest.Server, c *http.Client) {
	t.Helper()
	resp, err := c.PostForm(ts.URL+"/login", url.Values{"password": {password}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("login status %d", resp.StatusCode)
	}
}

func get(t *testing.T, c *http.Client, u string) (int, string) {
	t.Helper()
	resp, err := c.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func htmxPost(t *testing.T, c *http.Client, u string, form url.Values) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, u, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("HX-Request", "true")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func TestPagesNeedLogin(t *testing.T) {
	ts, _, _ := setup(t)
	c := client(t)
	for _, p := range []string{"/", "/buckets", "/runs", "/archive", "/audit"} {
		if code, _ := get(t, c, ts.URL+p); code != http.StatusSeeOther {
			t.Errorf("%s: status %d, want redirect to login", p, code)
		}
	}
	if code, _ := get(t, c, ts.URL+"/healthz"); code != http.StatusOK {
		t.Errorf("healthz should be open, got %d", code)
	}
}

func TestWrongPasswordIsRejectedAndAudited(t *testing.T) {
	ts, l, _ := setup(t)
	resp, err := client(t).PostForm(ts.URL+"/login", url.Values{"password": {"nope"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d", resp.StatusCode)
	}
	log, _ := l.AuditLog(context.Background(), 10)
	if len(log) != 1 || log[0].Action != "login failed" {
		t.Fatalf("audit = %+v", log)
	}
}

func TestPagesRender(t *testing.T) {
	ts, _, _ := setup(t)
	c := client(t)
	login(t, ts, c)
	for p, want := range map[string]string{
		"/":                                "recordings-test",
		"/buckets":                         "Dry run",
		"/runs":                            "No runs yet",
		"/archive":                         "Key prefix",
		"/archive/results?q=recordings%2F": "No archived objects",
		"/audit":                           "login",
	} {
		code, body := get(t, c, ts.URL+p)
		if code != http.StatusOK || !strings.Contains(body, want) {
			t.Errorf("%s: status %d, missing %q", p, code, want)
		}
	}
}

func TestPostWithoutHtmxHeaderIsForbidden(t *testing.T) {
	ts, _, _ := setup(t)
	c := client(t)
	login(t, ts, c)
	resp, err := c.PostForm(ts.URL+"/buckets/recordings-test/enable", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status %d, want 403", resp.StatusCode)
	}
}

func TestBucketActions(t *testing.T) {
	ts, l, _ := setup(t)
	c := client(t)
	login(t, ts, c)
	ctx := context.Background()

	_, body := htmxPost(t, c, ts.URL+"/buckets/recordings-test/arm", nil)
	if !strings.Contains(body, "must be enabled") {
		t.Fatalf("arming a disabled bucket should explain why: %s", body)
	}
	htmxPost(t, c, ts.URL+"/buckets/recordings-test/enable", nil)
	_, body = htmxPost(t, c, ts.URL+"/buckets/recordings-test/run", nil)
	if !strings.Contains(body, "enabled and armed") {
		t.Fatalf("a live run of an unarmed bucket should be refused: %s", body)
	}
	htmxPost(t, c, ts.URL+"/buckets/recordings-test/arm", nil)
	b, _ := l.Bucket(ctx, "recordings-test")
	if !b.Enabled || !b.Armed {
		t.Fatalf("bucket = %+v", b)
	}
	if code, _ := htmxPost(t, c, ts.URL+"/buckets/not-configured/enable", nil); code != http.StatusNotFound {
		t.Fatalf("unknown bucket: status %d", code)
	}
	log, _ := l.AuditLog(ctx, 10)
	var actions []string
	for _, e := range log {
		actions = append(actions, e.Action)
	}
	if got := strings.Join(actions, ","); got != "bucket arm,bucket enable,login" {
		t.Fatalf("audit actions = %s", got)
	}
}

func TestRestoreFromArchivePage(t *testing.T) {
	ts, l, src := setup(t)
	c := client(t)
	login(t, ts, c)
	ctx := context.Background()
	key := "recordings/2026/07/01/room.ogg"
	src.Add("recordings-test", key, []byte("ogg"), time.Now().Add(-60*24*time.Hour))
	l.SetBucket(ctx, "recordings-test", "enabled", true)
	l.SetBucket(ctx, "recordings-test", "armed", true)
	for range 2 { // copy, then delete one run later
		htmxPost(t, c, ts.URL+"/buckets/recordings-test/run", nil)
		waitIdle(t, c, ts)
	}
	if o, _, _ := l.Object(ctx, "recordings-test", key); o.State != ledger.StateDeleted {
		t.Fatalf("state = %q", o.State)
	}
	_, body := htmxPost(t, c, ts.URL+"/archive/restore", url.Values{"bucket": {"recordings-test"}, "key": {key}, "q": {"recordings/"}})
	if !strings.Contains(body, "Restored") {
		t.Fatalf("restore response: %s", body)
	}
	if d, ok := src.Data("recordings-test", key); !ok || string(d) != "ogg" {
		t.Fatal("object should be back on S3")
	}
}

// waitIdle polls the runs table until no run is in progress.
func waitIdle(t *testing.T, c *http.Client, ts *httptest.Server) {
	t.Helper()
	for range 100 {
		_, body := get(t, c, ts.URL+"/runs/table")
		if !strings.Contains(body, "Running:") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("run did not finish")
}
