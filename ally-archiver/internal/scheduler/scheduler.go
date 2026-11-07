// Package scheduler fires the weekly live run over every enabled, armed bucket.
package scheduler

import (
	"context"
	"log/slog"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/ledger"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/mover"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/notify"
)

const pausedKey = "schedule_paused"

type Scheduler struct {
	Ledger *ledger.Ledger
	Runner *mover.Runner
	Slack  *notify.Slack
	Log    *slog.Logger

	cron  *cron.Cron
	entry cron.EntryID
}

// Start begins the schedule. The spec is standard five-field cron, read in UTC.
func (s *Scheduler) Start(spec string) error {
	s.cron = cron.New(cron.WithLocation(time.UTC))
	id, err := s.cron.AddFunc(spec, func() { s.Tick(context.Background()) })
	if err != nil {
		return err
	}
	s.entry = id
	s.cron.Start()
	return nil
}

func (s *Scheduler) Stop() {
	if s.cron != nil {
		<-s.cron.Stop().Done()
	}
}

// Next is when the schedule fires next; zero when it isn't running.
func (s *Scheduler) Next() time.Time {
	if s.cron == nil {
		return time.Time{}
	}
	return s.cron.Entry(s.entry).Next
}

func (s *Scheduler) Paused(ctx context.Context) bool {
	v, _ := s.Ledger.Setting(ctx, pausedKey)
	return v == "1"
}

func (s *Scheduler) SetPaused(ctx context.Context, paused bool) error {
	v := "0"
	if paused {
		v = "1"
	}
	return s.Ledger.SetSetting(ctx, pausedKey, v)
}

// Tick is one scheduled firing: a live run over every enabled, armed bucket, then a Slack
// summary. It does nothing while paused or while another run holds the guard.
func (s *Scheduler) Tick(ctx context.Context) {
	log := s.Log
	if log == nil {
		log = slog.Default()
	}
	if s.Paused(ctx) {
		log.Info("scheduled run skipped: paused")
		return
	}
	buckets, err := s.Ledger.Buckets(ctx)
	if err != nil {
		log.Error("scheduled run: list buckets", "err", err)
		return
	}
	var armed []string
	for _, b := range buckets {
		if b.Enabled && b.Armed {
			armed = append(armed, b.Name)
		}
	}
	if len(armed) == 0 {
		log.Info("scheduled run skipped: no bucket is armed")
		return
	}
	runs, err := s.Runner.RunAll(armed, mover.ModeLive, "schedule")
	if err == mover.ErrBusy {
		log.Warn("scheduled run skipped: another run is in progress")
		s.send(ctx, log, "Storage archive weekly run skipped: another run was in progress.")
		return
	}
	if err != nil {
		log.Error("scheduled run", "err", err)
	}
	s.send(ctx, log, notify.Summary(runs, err))
}

func (s *Scheduler) send(ctx context.Context, log *slog.Logger, text string) {
	if err := s.Slack.Send(ctx, text); err != nil {
		log.Warn("slack notify", "err", err)
	}
}
