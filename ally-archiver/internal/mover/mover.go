// Package mover runs one bucket's pass: delete what earlier runs copied and verified, then
// copy and verify what has aged past the cutoff. Nothing leaves S3 in the run that copied it.
package mover

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/box"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/ledger"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/source"
)

const (
	ModeDry  = "dry"
	ModeLive = "live"
)

type Mover struct {
	Ledger *ledger.Ledger
	Source source.Source
	// OpenBox connects to the Storage Box; nil when it isn't configured, which allows dry
	// runs only.
	OpenBox      func() (box.Box, error)
	Root         string
	MinAge       time.Duration
	MaxBytesRun  int64 // 0 means no cap
	RateBytesSec int64 // 0 means unthrottled
	Workers      int
	Now          func() time.Time
	Log          *slog.Logger
}

func (m *Mover) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now()
}

// RemotePath maps an S3 key to its place on the box, refusing keys that would escape the
// bucket's directory or collide after path cleaning.
func (m *Mover) RemotePath(bucket, key string) (string, error) {
	if key == "" || strings.HasPrefix(key, "/") || strings.ContainsRune(key, 0) || strings.HasSuffix(key, ".part") {
		return "", fmt.Errorf("key %q can't be mapped to a safe path", key)
	}
	for _, seg := range strings.Split(key, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return "", fmt.Errorf("key %q can't be mapped to a safe path", key)
		}
	}
	return path.Join(m.Root, bucket, key), nil
}

// run carries one pass's counters; workers update it under mu.
type run struct {
	mu    sync.Mutex
	r     ledger.Run
	saved time.Time
}

func (x *run) add(fn func(r *ledger.Run)) {
	x.mu.Lock()
	fn(&x.r)
	x.mu.Unlock()
}

func (x *run) snapshot() ledger.Run {
	x.mu.Lock()
	defer x.mu.Unlock()
	return x.r
}

// Run does one pass over bucket. A dry run lists and counts only. A live run needs the
// bucket enabled and armed and the box reachable.
func (m *Mover) Run(ctx context.Context, bucket, mode, trigger string) (ledger.Run, error) {
	b, err := m.Ledger.Bucket(ctx, bucket)
	if err != nil {
		return ledger.Run{}, err
	}
	if mode != ModeDry && mode != ModeLive {
		return ledger.Run{}, fmt.Errorf("unknown mode %q", mode)
	}
	if mode == ModeLive {
		switch {
		case !b.Enabled:
			return ledger.Run{}, fmt.Errorf("bucket %s is disabled", bucket)
		case !b.Armed:
			return ledger.Run{}, fmt.Errorf("bucket %s is not armed; only dry runs are allowed", bucket)
		case m.OpenBox == nil:
			return ledger.Run{}, errors.New("the Storage Box is not configured; only dry runs are allowed")
		}
	}

	id, err := m.Ledger.StartRun(ctx, bucket, mode, trigger)
	if err != nil {
		return ledger.Run{}, err
	}
	x := &run{r: ledger.Run{ID: id, Bucket: bucket, Mode: mode, Trigger: trigger, Status: "running", StartedAt: m.now()}}
	log := m.log().With("run", id, "bucket", bucket, "mode", mode)
	log.Info("run started")

	err = m.pass(ctx, b, x, log)

	final := x.snapshot()
	final.FinishedAt = m.now()
	switch {
	case errors.Is(err, context.Canceled):
		final.Status, final.Error = "cancelled", "cancelled by an operator"
	case err != nil:
		final.Status, final.Error = "failed", err.Error()
	default:
		final.Status = "done"
	}
	// Record the outcome even if the run's own context was cancelled.
	if serr := m.Ledger.SaveRun(context.WithoutCancel(ctx), final); serr != nil && err == nil {
		err = serr
	}
	log.Info("run finished", "status", final.Status, "copied", final.Copied, "deleted", final.Deleted, "failed", final.Failed)
	return final, err
}

func (m *Mover) pass(ctx context.Context, b ledger.Bucket, x *run, log *slog.Logger) error {
	var bx box.Box
	if x.r.Mode == ModeLive {
		var err error
		if bx, err = m.OpenBox(); err != nil {
			return err
		}
		defer bx.Close()
		if b.BlockedReason != "" {
			log.Warn("deletes blocked", "reason", b.BlockedReason)
		} else if err := m.deletePending(ctx, b.Name, bx, x, log); err != nil {
			return err
		}
	}
	if err := m.copyAged(ctx, b.Name, bx, x, log); err != nil {
		return err
	}
	if bx != nil {
		if err := m.backupLedger(ctx, bx, x.r.ID); err != nil {
			// The objects are already safe; a missed backup is reported, not fatal.
			log.Error("ledger backup failed", "err", err)
			x.add(func(r *ledger.Run) { r.Error = "ledger backup failed: " + err.Error() })
		}
	}
	return nil
}

// deletePending removes from S3 what an earlier run copied, after checking the box still
// holds the same bytes and S3 still holds the object that was copied.
func (m *Mover) deletePending(ctx context.Context, bucket string, bx box.Box, x *run, log *slog.Logger) error {
	pending, err := m.Ledger.PendingDeletes(ctx, bucket, x.r.ID)
	if err != nil {
		return err
	}
	for _, o := range pending {
		if err := ctx.Err(); err != nil {
			return err
		}
		sum, size, err := bx.Hash(ctx, o.RemotePath)
		if err != nil || sum != o.SHA256 || size != o.Size {
			reason := fmt.Sprintf("box copy of %s no longer matches the ledger", o.Key)
			if err != nil {
				reason = fmt.Sprintf("box copy of %s can't be verified: %v", o.Key, err)
			}
			log.Error("verify before delete failed; blocking deletes", "key", o.Key, "reason", reason)
			x.add(func(r *ledger.Run) { r.Failed++ })
			if err := m.Ledger.MarkFailed(ctx, bucket, o.Key, o.RemotePath, reason, x.r.ID); err != nil {
				return err
			}
			return m.Ledger.Block(ctx, bucket, reason)
		}
		cur, err := m.Source.Head(ctx, bucket, o.Key)
		if errors.Is(err, source.ErrNotFound) {
			// Ally deleted it itself (chat audio goes once its summary is done).
			if err := m.Ledger.MarkDeleted(ctx, bucket, o.Key, "already gone from S3"); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if cur.ETag != o.ETag || cur.Size != o.Size {
			// Overwritten since the copy; let the copy phase take the new version.
			if err := m.Ledger.MarkFailed(ctx, bucket, o.Key, o.RemotePath, "changed on S3 since it was copied; copying again", x.r.ID); err != nil {
				return err
			}
			continue
		}
		if err := m.Source.Delete(ctx, bucket, o.Key); err != nil {
			x.add(func(r *ledger.Run) { r.Failed++ })
			if err := m.Ledger.SetError(ctx, bucket, o.Key, err.Error()); err != nil {
				return err
			}
			log.Error("delete failed", "key", o.Key, "err", err)
			continue
		}
		if err := m.Ledger.MarkDeleted(ctx, bucket, o.Key, ""); err != nil {
			return err
		}
		x.add(func(r *ledger.Run) { r.Deleted++; r.DeletedBytes += o.Size })
		m.maybeSave(ctx, x)
	}
	return nil
}

// copyAged lists the bucket, counts everything, and in a live run copies and verifies each
// object older than the cutoff that isn't already archived.
func (m *Mover) copyAged(ctx context.Context, bucket string, bx box.Box, x *run, log *slog.Logger) error {
	cutoff := m.now().Add(-m.MinAge)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	jobs := make(chan source.Object)
	var wg sync.WaitGroup
	var lim *limiter
	if m.RateBytesSec > 0 {
		lim = &limiter{rate: m.RateBytesSec}
	}
	var fatalOnce sync.Once
	var fatal error
	if x.r.Mode == ModeLive {
		for range max(m.Workers, 1) {
			wg.Go(func() {
				for o := range jobs {
					if err := m.copyOne(ctx, bucket, bx, o, lim, x, log); err != nil {
						fatalOnce.Do(func() { fatal = err; cancel() })
					}
				}
			})
		}
	}

	var queued int64
	capped := false
	err := m.Source.List(ctx, bucket, func(o source.Object) error {
		x.add(func(r *ledger.Run) { r.Scanned++; r.ScannedBytes += o.Size })
		if !o.LastModified.Before(cutoff) || (strings.HasSuffix(o.Key, "/") && o.Size == 0) {
			return nil
		}
		row, ok, err := m.Ledger.Object(ctx, bucket, o.Key)
		if err != nil {
			return err
		}
		if ok {
			switch row.State {
			case ledger.StateCopied:
				return nil
			case ledger.StateDeleted:
				// The key was written again after it was archived. Copying would overwrite the
				// archived version, so leave it for an operator.
				if o.LastModified.After(row.S3LastModified) {
					log.Warn("key re-created on S3 after it was archived; skipping", "key", o.Key)
				}
				return nil
			}
		}
		x.add(func(r *ledger.Run) { r.Eligible++; r.EligibleBytes += o.Size })
		m.maybeSave(ctx, x)
		if x.r.Mode != ModeLive || capped {
			return nil
		}
		if m.MaxBytesRun > 0 && queued+o.Size > m.MaxBytesRun && queued > 0 {
			capped = true
			log.Info("per-run byte cap reached; the rest waits for the next run", "cap", m.MaxBytesRun)
			return nil
		}
		queued += o.Size
		select {
		case jobs <- o:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	close(jobs)
	wg.Wait()
	if fatal != nil {
		return fatal
	}
	return err
}

// copyOne copies and verifies one object. Problems with the object itself are recorded on
// its ledger row; only ledger failures are returned, and they stop the run.
func (m *Mover) copyOne(ctx context.Context, bucket string, bx box.Box, o source.Object, lim *limiter, x *run, log *slog.Logger) error {
	fail := func(remote, msg string) error {
		x.add(func(r *ledger.Run) { r.Failed++ })
		log.Error("copy failed", "key", o.Key, "err", msg)
		return m.Ledger.MarkFailed(ctx, bucket, o.Key, remote, msg, x.r.ID)
	}
	remote, err := m.RemotePath(bucket, o.Key)
	if err != nil {
		return fail("", err.Error())
	}
	body, err := m.Source.Get(ctx, bucket, o.Key)
	if errors.Is(err, source.ErrNotFound) {
		return nil // deleted between the listing and now
	}
	if err != nil {
		return fail(remote, err.Error())
	}
	var r io.Reader = body
	if lim != nil {
		r = &throttled{ctx: ctx, r: body, lim: lim}
	}
	n, sum, err := bx.Put(ctx, remote, r)
	body.Close()
	if err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return fail(remote, err.Error())
	}
	if n != o.Size {
		return fail(remote, fmt.Sprintf("copied %d bytes, S3 listed %d", n, o.Size))
	}
	rsum, rsize, err := bx.Hash(ctx, remote)
	if err != nil || rsum != sum || rsize != n {
		msg := fmt.Sprintf("box copy of %s doesn't match what was sent", o.Key)
		if err != nil {
			msg = fmt.Sprintf("box copy of %s can't be verified: %v", o.Key, err)
		}
		if err := fail(remote, msg); err != nil {
			return err
		}
		return m.Ledger.Block(ctx, bucket, msg)
	}
	if err := m.Ledger.MarkCopied(ctx, ledger.Object{
		Bucket: bucket, Key: o.Key, Size: n, SHA256: sum, ETag: o.ETag,
		S3LastModified: o.LastModified, RemotePath: remote,
	}, x.r.ID); err != nil {
		return err
	}
	x.add(func(r *ledger.Run) { r.Copied++; r.CopiedBytes += n })
	m.maybeSave(ctx, x)
	return nil
}

// maybeSave writes progress at most every two seconds so the UI can follow a run.
func (m *Mover) maybeSave(ctx context.Context, x *run) {
	x.mu.Lock()
	if time.Since(x.saved) < 2*time.Second {
		x.mu.Unlock()
		return
	}
	x.saved = time.Now()
	snap := x.r
	x.mu.Unlock()
	if err := m.Ledger.SaveRun(ctx, snap); err != nil {
		m.log().Warn("save run progress", "err", err)
	}
}

func (m *Mover) backupLedger(ctx context.Context, bx box.Box, runID int64) error {
	tmp := filepath.Join(os.TempDir(), fmt.Sprintf("archiver-ledger-%d.db", runID))
	os.Remove(tmp)
	defer os.Remove(tmp)
	if err := m.Ledger.Backup(ctx, tmp); err != nil {
		return err
	}
	f, err := os.Open(tmp)
	if err != nil {
		return err
	}
	defer f.Close()
	_, _, err = bx.Put(ctx, path.Join(m.Root, "_ledger", fmt.Sprintf("ledger-run-%06d.db", runID)), f)
	return err
}

// Restore copies an archived object back to its original S3 key. It refuses when S3 already
// has something at that key, so a restore never overwrites newer data.
func (m *Mover) Restore(ctx context.Context, bucket, key string) error {
	o, ok, err := m.Ledger.Object(ctx, bucket, key)
	if err != nil {
		return err
	}
	if !ok || o.State != ledger.StateDeleted {
		return fmt.Errorf("%s/%s is not archived-only (state %q); nothing to restore", bucket, key, o.State)
	}
	if m.OpenBox == nil {
		return errors.New("the Storage Box is not configured")
	}
	if _, err := m.Source.Head(ctx, bucket, key); err == nil {
		return fmt.Errorf("%s/%s already exists on S3; refusing to overwrite it", bucket, key)
	} else if !errors.Is(err, source.ErrNotFound) {
		return err
	}
	bx, err := m.OpenBox()
	if err != nil {
		return err
	}
	defer bx.Close()
	sum, size, err := bx.Hash(ctx, o.RemotePath)
	if err != nil {
		return err
	}
	if sum != o.SHA256 || size != o.Size {
		return fmt.Errorf("box copy of %s doesn't match the ledger; not restoring", key)
	}
	r, err := bx.Get(ctx, o.RemotePath)
	if err != nil {
		return err
	}
	defer r.Close()
	if err := m.Source.Put(ctx, bucket, key, r, o.Size); err != nil {
		return err
	}
	got, err := m.Source.Head(ctx, bucket, key)
	if err != nil {
		return fmt.Errorf("check restored object: %w", err)
	}
	if got.Size != o.Size {
		return fmt.Errorf("restored %s is %d bytes, expected %d", key, got.Size, o.Size)
	}
	return m.Ledger.MarkRestored(ctx, bucket, key)
}

func (m *Mover) log() *slog.Logger {
	if m.Log != nil {
		return m.Log
	}
	return slog.Default()
}

// limiter paces reads across all workers to a shared byte rate.
type limiter struct {
	mu   sync.Mutex
	rate int64
	next time.Time
}

func (l *limiter) wait(ctx context.Context, n int) error {
	l.mu.Lock()
	now := time.Now()
	start := l.next
	if start.Before(now) {
		start = now
	}
	l.next = start.Add(time.Duration(int64(n) * int64(time.Second) / l.rate))
	l.mu.Unlock()
	if d := start.Sub(now); d > 0 {
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-t.C:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

type throttled struct {
	ctx context.Context
	r   io.Reader
	lim *limiter
}

func (t *throttled) Read(p []byte) (int, error) {
	if len(p) > 256<<10 {
		p = p[:256<<10]
	}
	n, err := t.r.Read(p)
	if n > 0 {
		if werr := t.lim.wait(t.ctx, n); werr != nil {
			return n, werr
		}
	}
	return n, err
}
