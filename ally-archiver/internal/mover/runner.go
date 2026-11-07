package mover

import (
	"context"
	"errors"
	"sync"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/ledger"
)

// ErrBusy means another run is in progress; only one runs at a time.
var ErrBusy = errors.New("a run is already in progress")

// Runner makes sure only one pass runs at a time, from the UI, the schedule or the CLI, and
// lets an operator cancel it.
type Runner struct {
	M *Mover

	mu      sync.Mutex
	running bool
	label   string
	cancel  context.CancelFunc
}

func (r *Runner) acquire(label string) (context.Context, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.running {
		return nil, ErrBusy
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.running, r.label, r.cancel = true, label, cancel
	return ctx, nil
}

func (r *Runner) release() {
	r.mu.Lock()
	r.cancel()
	r.running, r.label, r.cancel = false, "", nil
	r.mu.Unlock()
}

// Busy reports whether a run is in progress, and what it is.
func (r *Runner) Busy() (bool, string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.running, r.label
}

// Cancel stops the current run, if any. The run finishes the object it is on and records
// itself as cancelled.
func (r *Runner) Cancel() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.running {
		return false
	}
	r.cancel()
	return true
}

// Start runs one bucket in the background and returns once it has begun.
func (r *Runner) Start(bucket, mode, trigger string) error {
	ctx, err := r.acquire(bucket + " (" + mode + ")")
	if err != nil {
		return err
	}
	go func() {
		defer r.release()
		r.M.Run(ctx, bucket, mode, trigger)
	}()
	return nil
}

// RunAll runs the given buckets one after another and returns their results. It holds the
// guard for the whole batch, so a manual run can't slip in between two scheduled ones.
func (r *Runner) RunAll(buckets []string, mode, trigger string) ([]ledger.Run, error) {
	ctx, err := r.acquire("scheduled run")
	if err != nil {
		return nil, err
	}
	defer r.release()
	var out []ledger.Run
	var errs []error
	for _, b := range buckets {
		run, err := r.M.Run(ctx, b, mode, trigger)
		if run.ID != 0 {
			out = append(out, run)
		}
		if err != nil {
			errs = append(errs, err)
			if errors.Is(err, context.Canceled) {
				break
			}
		}
	}
	return out, errors.Join(errs...)
}
