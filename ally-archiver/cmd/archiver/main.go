// Command archiver moves private S3 objects older than a cutoff to a Hetzner Storage Box.
//
//	archiver serve                         web UI + weekly schedule
//	archiver inventory                     dry run over every configured bucket
//	archiver run -bucket NAME [-dry-run]   one pass now
//	archiver restore -bucket NAME -key K   copy an archived object back to S3
//	archiver hash-password                 print a bcrypt hash for ARCHIVER_ADMIN_PASSWORD_HASH
//
// See https://tech.helloally.ai/#/wiki/repos/ally-archiver.md
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/box"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/config"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/ledger"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/mover"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/notify"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/scheduler"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/source"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/web"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(log)
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: archiver serve|inventory|run|restore|hash-password")
		os.Exit(2)
	}
	cmd, args := os.Args[1], os.Args[2:]
	if cmd == "hash-password" {
		exit(hashPassword())
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	app, err := setup(ctx, log)
	if err != nil {
		exit(err)
	}
	defer app.ledger.Close()

	switch cmd {
	case "serve":
		err = app.serve(ctx)
	case "inventory":
		err = app.inventory(ctx)
	case "run":
		err = app.runOne(ctx, args)
	case "restore":
		err = app.restore(ctx, args)
	default:
		err = fmt.Errorf("unknown command %q", cmd)
	}
	exit(err)
}

func exit(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "archiver:", err)
		os.Exit(1)
	}
	os.Exit(0)
}

type app struct {
	cfg    *config.Config
	ledger *ledger.Ledger
	mover  *mover.Mover
	log    *slog.Logger
}

func setup(ctx context.Context, log *slog.Logger) (*app, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	l, err := ledger.Open(cfg.DBPath)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, b := range cfg.Buckets {
		names = append(names, b.Name)
	}
	if err := l.SyncBuckets(ctx, names); err != nil {
		return nil, err
	}
	src, err := source.NewS3(ctx, cfg)
	if err != nil {
		return nil, err
	}
	m := &mover.Mover{
		Ledger: l, Source: src, Root: cfg.BoxRoot, MinAge: cfg.MinAge,
		MaxBytesRun: cfg.MaxBytesRun, RateBytesSec: cfg.RateBytesSec, Workers: cfg.Workers, Log: log,
	}
	if cfg.BoxConfigured() {
		opts := box.Options{Addr: cfg.BoxAddr, User: cfg.BoxUser, KeyFile: cfg.BoxKeyFile, KnownHosts: cfg.BoxKnownHosts, HashMode: cfg.BoxHashMode}
		m.OpenBox = func() (box.Box, error) { return box.Dial(opts) }
	}
	return &app{cfg: cfg, ledger: l, mover: m, log: log}, nil
}

func (a *app) serve(ctx context.Context) error {
	if a.cfg.AdminPasswordHash == "" {
		return errors.New("ARCHIVER_ADMIN_PASSWORD_HASH is empty; set it with `archiver hash-password`")
	}
	if err := a.ledger.FailOrphanRuns(ctx); err != nil {
		return err
	}
	runner := &mover.Runner{M: a.mover}
	sched := &scheduler.Scheduler{Ledger: a.ledger, Runner: runner, Slack: &notify.Slack{WebhookURL: a.cfg.SlackWebhookURL}, Log: a.log}
	if err := sched.Start(a.cfg.Schedule); err != nil {
		return fmt.Errorf("ARCHIVER_SCHEDULE: %w", err)
	}
	defer sched.Stop()

	srv := &web.Server{Cfg: a.cfg, Ledger: a.ledger, Mover: a.mover, Runner: runner, Sched: sched, Log: a.log}
	h, err := srv.Handler()
	if err != nil {
		return err
	}
	hs := &http.Server{Addr: a.cfg.Listen, Handler: h, ReadHeaderTimeout: 10 * time.Second}
	errc := make(chan error, 1)
	go func() { errc <- hs.ListenAndServe() }()
	a.log.Info("archiver listening", "addr", a.cfg.Listen, "next_run", sched.Next())
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	runner.Cancel()
	shut, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return hs.Shutdown(shut)
}

func (a *app) inventory(ctx context.Context) error {
	if len(a.cfg.Buckets) == 0 {
		return errors.New("no buckets configured; set ARCHIVER_BUCKETS_FILE")
	}
	fmt.Printf("%-40s %12s %12s %12s %12s %10s\n", "BUCKET", "OBJECTS", "SIZE", "ELIGIBLE", "ELIG. SIZE", "EGRESS")
	for _, b := range a.cfg.Buckets {
		r, err := a.mover.Run(ctx, b.Name, mover.ModeDry, "cli")
		if err != nil {
			fmt.Printf("%-40s error: %v\n", b.Name, err)
			continue
		}
		fmt.Printf("%-40s %12d %12s %12d %12s %10s\n", b.Name, r.Scanned, notify.Bytes(r.ScannedBytes),
			r.Eligible, notify.Bytes(r.EligibleBytes), fmt.Sprintf("$%.2f", float64(r.EligibleBytes)/1e9*a.cfg.EgressUSDPerGB))
	}
	return nil
}

func (a *app) runOne(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	bucket := fs.String("bucket", "", "bucket to run")
	dry := fs.Bool("dry-run", false, "list and count only")
	fs.Parse(args)
	if *bucket == "" {
		return errors.New("-bucket is required")
	}
	mode := mover.ModeLive
	if *dry {
		mode = mover.ModeDry
	}
	r, err := a.mover.Run(ctx, *bucket, mode, "cli")
	if r.ID != 0 {
		fmt.Printf("run %d %s: scanned %d, eligible %d (%s), copied %d (%s), deleted %d (%s), failed %d\n",
			r.ID, r.Status, r.Scanned, r.Eligible, notify.Bytes(r.EligibleBytes), r.Copied, notify.Bytes(r.CopiedBytes),
			r.Deleted, notify.Bytes(r.DeletedBytes), r.Failed)
	}
	return err
}

func (a *app) restore(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("restore", flag.ExitOnError)
	bucket := fs.String("bucket", "", "bucket the object came from")
	key := fs.String("key", "", "the object's S3 key")
	fs.Parse(args)
	if *bucket == "" || *key == "" {
		return errors.New("-bucket and -key are required")
	}
	if err := a.mover.Restore(ctx, *bucket, *key); err != nil {
		return err
	}
	a.ledger.Audit(ctx, "cli", "restore", *bucket+"/"+*key)
	fmt.Println("restored", *key)
	return nil
}

func hashPassword() error {
	fmt.Fprint(os.Stderr, "password: ")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return err
	}
	pw := strings.TrimRight(line, "\r\n")
	if len(pw) < 12 {
		return errors.New("use at least 12 characters")
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), 12)
	if err != nil {
		return err
	}
	fmt.Println(string(h))
	return nil
}
