package mover

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/fake"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/ledger"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/source"
)

const bucket = "recordings-test"

var now = time.Date(2026, 10, 25, 2, 0, 0, 0, time.UTC)

type env struct {
	m   *Mover
	src *fake.Source
	box *fake.Box
	l   *ledger.Ledger
}

func setup(t *testing.T) *env {
	t.Helper()
	l, err := ledger.Open(filepath.Join(t.TempDir(), "ledger.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	ctx := context.Background()
	if err := l.SyncBuckets(ctx, []string{bucket}); err != nil {
		t.Fatal(err)
	}
	src, bx := fake.NewSource(), fake.NewBox()
	src.Now = func() time.Time { return now }
	m := &Mover{
		Ledger: l, Source: src, OpenBox: bx.Open, Root: "ally-archive",
		MinAge: 30 * 24 * time.Hour, Workers: 2, Now: func() time.Time { return now },
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	return &env{m: m, src: src, box: bx, l: l}
}

func (e *env) arm(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	if err := e.l.SetBucket(ctx, bucket, "enabled", true); err != nil {
		t.Fatal(err)
	}
	if err := e.l.SetBucket(ctx, bucket, "armed", true); err != nil {
		t.Fatal(err)
	}
}

func (e *env) live(t *testing.T) ledger.Run {
	t.Helper()
	r, err := e.m.Run(context.Background(), bucket, ModeLive, "test")
	if err != nil {
		t.Fatalf("live run: %v", err)
	}
	return r
}

func days(n int) time.Time { return now.Add(-time.Duration(n) * 24 * time.Hour) }

func (e *env) state(t *testing.T, key string) string {
	t.Helper()
	o, ok, err := e.l.Object(context.Background(), bucket, key)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		return ""
	}
	return o.State
}

func TestDryRunCountsAndWritesNothing(t *testing.T) {
	e := setup(t)
	e.src.Add(bucket, "recordings/2026/08/01/a.ogg", []byte("aaaa"), days(80))
	e.src.Add(bucket, "recordings/2026/10/20/b.ogg", []byte("bb"), days(5))

	r, err := e.m.Run(context.Background(), bucket, ModeDry, "test")
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != "done" || r.Scanned != 2 || r.ScannedBytes != 6 || r.Eligible != 1 || r.EligibleBytes != 4 || r.Copied != 0 {
		t.Fatalf("unexpected dry run: %+v", r)
	}
	if e.box.Opens != 0 {
		t.Fatal("a dry run must not connect to the box")
	}
	if e.state(t, "recordings/2026/08/01/a.ogg") != "" {
		t.Fatal("a dry run must not write object rows")
	}
}

func TestLiveRunNeedsEnabledArmedAndBox(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	if _, err := e.m.Run(ctx, bucket, ModeLive, "test"); err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("want disabled error, got %v", err)
	}
	e.l.SetBucket(ctx, bucket, "enabled", true)
	if _, err := e.m.Run(ctx, bucket, ModeLive, "test"); err == nil || !strings.Contains(err.Error(), "not armed") {
		t.Fatalf("want not-armed error, got %v", err)
	}
	e.l.SetBucket(ctx, bucket, "armed", true)
	e.m.OpenBox = nil
	if _, err := e.m.Run(ctx, bucket, ModeLive, "test"); err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("want box error, got %v", err)
	}
}

func TestArmNeedsEnabledAndDisableDisarms(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	if err := e.l.SetBucket(ctx, bucket, "armed", true); err == nil {
		t.Fatal("arming a disabled bucket should fail")
	}
	e.arm(t)
	e.l.SetBucket(ctx, bucket, "enabled", false)
	b, _ := e.l.Bucket(ctx, bucket)
	if b.Armed {
		t.Fatal("disabling should disarm")
	}
}

func TestCopyThenDeleteOneRunLater(t *testing.T) {
	e := setup(t)
	e.arm(t)
	old, fresh := "recordings/2026/08/01/a.ogg", "recordings/2026/10/20/b.ogg"
	e.src.Add(bucket, old, []byte("old audio"), days(80))
	e.src.Add(bucket, fresh, []byte("new"), days(5))

	r1 := e.live(t)
	if r1.Copied != 1 || r1.Deleted != 0 {
		t.Fatalf("run 1: %+v", r1)
	}
	if got, ok := e.box.File("ally-archive/" + bucket + "/" + old); !ok || string(got) != "old audio" {
		t.Fatalf("box copy missing or wrong: %q", got)
	}
	if _, ok := e.src.Data(bucket, old); !ok {
		t.Fatal("the run that copies must not delete")
	}
	if e.state(t, old) != ledger.StateCopied {
		t.Fatalf("state = %q", e.state(t, old))
	}

	r2 := e.live(t)
	if r2.Deleted != 1 || r2.DeletedBytes != 9 || r2.Copied != 0 {
		t.Fatalf("run 2: %+v", r2)
	}
	if _, ok := e.src.Data(bucket, old); ok {
		t.Fatal("run 2 should delete the copied object from S3")
	}
	if _, ok := e.src.Data(bucket, fresh); !ok {
		t.Fatal("a fresh object must stay on S3")
	}
	if e.state(t, old) != ledger.StateDeleted {
		t.Fatalf("state = %q", e.state(t, old))
	}
	if e.state(t, fresh) != "" {
		t.Fatal("a fresh object must not be in the ledger")
	}
	if _, ok := e.box.File("ally-archive/_ledger/ledger-run-000002.db"); !ok {
		t.Fatal("the ledger should be backed up to the box after a live run")
	}

	r3 := e.live(t)
	if r3.Copied != 0 || r3.Deleted != 0 || r3.Failed != 0 {
		t.Fatalf("run 3 should be a no-op: %+v", r3)
	}
}

func TestCorruptBoxCopyBlocksDeletes(t *testing.T) {
	e := setup(t)
	e.arm(t)
	key := "agent-traces/guide/2026/08/t1.json"
	e.src.Add(bucket, key, []byte(`{"turn":1}`), days(60))
	e.live(t)
	e.box.Corrupt("ally-archive/" + bucket + "/" + key)

	r := e.live(t)
	if r.Deleted != 0 {
		t.Fatal("nothing may be deleted when the box copy doesn't verify")
	}
	if _, ok := e.src.Data(bucket, key); !ok {
		t.Fatal("the object must still be on S3")
	}
	b, _ := e.l.Bucket(context.Background(), bucket)
	if b.BlockedReason == "" {
		t.Fatal("the bucket should be blocked")
	}
	// The copy phase re-copied it in the same run, so the box holds good bytes again, but
	// deletes stay blocked until an operator clears them.
	if e.state(t, key) != ledger.StateCopied {
		t.Fatalf("state = %q, want copied after re-copy", e.state(t, key))
	}
	if r4 := e.live(t); r4.Deleted != 0 {
		t.Fatal("deletes must stay blocked until unblocked")
	}
	e.l.Unblock(context.Background(), bucket)
	if r5 := e.live(t); r5.Deleted != 1 {
		t.Fatalf("after unblock the object should be deleted: %+v", r5)
	}
}

func TestObjectChangedOnS3IsNotDeleted(t *testing.T) {
	e := setup(t)
	e.arm(t)
	key := "audio-upload/2026/08/01/x.webm"
	e.src.Add(bucket, key, []byte("v1"), days(60))
	e.live(t)
	e.src.Add(bucket, key, []byte("version two"), days(1))

	if r := e.live(t); r.Deleted != 0 {
		t.Fatal("an object overwritten since its copy must not be deleted")
	}
	if got, _ := e.src.Data(bucket, key); string(got) != "version two" {
		t.Fatal("the new version must stay on S3")
	}
	if e.state(t, key) != ledger.StateFailed {
		t.Fatalf("state = %q", e.state(t, key))
	}
}

func TestObjectAlreadyGoneIsMarkedDeleted(t *testing.T) {
	e := setup(t)
	e.arm(t)
	key := "microphone-chat/2026/08/01/chat-1.raw"
	e.src.Add(bucket, key, []byte("pcm"), days(60))
	e.live(t)
	e.src.Remove(bucket, key) // ally-be cleaned it up after the summary

	r := e.live(t)
	if r.Deleted != 0 || len(e.src.Deletes) != 0 {
		t.Fatalf("nothing to delete: %+v %v", r, e.src.Deletes)
	}
	if e.state(t, key) != ledger.StateDeleted {
		t.Fatalf("state = %q", e.state(t, key))
	}
}

func TestByteCapLeavesTheRestForNextRun(t *testing.T) {
	e := setup(t)
	e.arm(t)
	e.m.MaxBytesRun = 10
	e.m.Workers = 1
	for _, k := range []string{"a", "b", "c"} {
		e.src.Add(bucket, "recordings/"+k, []byte("123456"), days(40))
	}
	r := e.live(t)
	if r.Eligible != 3 || r.Copied != 1 {
		t.Fatalf("cap of 10 bytes should copy one 6-byte object: %+v", r)
	}
	r = e.live(t)
	if r.Copied != 1 || r.Deleted != 1 {
		t.Fatalf("second run: %+v", r)
	}
}

func TestUnsafeKeysAreRefused(t *testing.T) {
	e := setup(t)
	e.arm(t)
	for _, k := range []string{"../escape", "a//b", "/abs", "x.part"} {
		e.src.Add(bucket, k, []byte("data"), days(40))
	}
	r := e.live(t)
	if r.Copied != 0 || r.Failed != 4 {
		t.Fatalf("all four keys should fail: %+v", r)
	}
	if r := e.live(t); r.Deleted != 0 {
		t.Fatal("refused keys must never be deleted")
	}
}

func TestRestore(t *testing.T) {
	e := setup(t)
	e.arm(t)
	ctx := context.Background()
	key := "recordings/2026/07/01/room.ogg"
	e.src.Add(bucket, key, []byte("ogg bytes"), days(100))
	if err := e.m.Restore(ctx, bucket, key); err == nil {
		t.Fatal("restoring an object still on S3 should fail")
	}
	e.live(t)
	e.live(t)
	if err := e.m.Restore(ctx, bucket, key); err != nil {
		t.Fatal(err)
	}
	if got, _ := e.src.Data(bucket, key); string(got) != "ogg bytes" {
		t.Fatalf("restored %q", got)
	}
	if e.state(t, key) != ledger.StateRestored {
		t.Fatalf("state = %q", e.state(t, key))
	}
	if err := e.m.Restore(ctx, bucket, key); err == nil {
		t.Fatal("a second restore should be refused")
	}
}

func TestRunnerAllowsOneRunAtATime(t *testing.T) {
	r := &Runner{M: setup(t).m}
	ctx, err := r.acquire("first")
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Start(bucket, ModeDry, "test"); err != ErrBusy {
		t.Fatalf("want ErrBusy, got %v", err)
	}
	if !r.Cancel() || ctx.Err() == nil {
		t.Fatal("cancel should cancel the running context")
	}
	r.release()
	if busy, _ := r.Busy(); busy {
		t.Fatal("released runner should be idle")
	}
}

// cancellingSource cancels the run as soon as listing starts, as an operator would mid-run.
type cancellingSource struct {
	*fake.Source
	cancel context.CancelFunc
}

func (c cancellingSource) List(ctx context.Context, b string, fn func(source.Object) error) error {
	c.cancel()
	return c.Source.List(ctx, b, fn)
}

func TestCancelledRunIsRecorded(t *testing.T) {
	e := setup(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	e.src.Add(bucket, "recordings/a", []byte("x"), days(40))
	e.m.Source = cancellingSource{e.src, cancel}
	r, err := e.m.Run(ctx, bucket, ModeDry, "test")
	if err == nil || r.Status != "cancelled" {
		t.Fatalf("want cancelled run, got %+v, %v", r, err)
	}
	saved, _ := e.l.Run(context.Background(), r.ID)
	if saved.Status != "cancelled" {
		t.Fatalf("saved status = %q", saved.Status)
	}
}
