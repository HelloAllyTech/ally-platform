// Package web is the archiver's operator UI: server-rendered pages with htmx for actions and
// live progress. It sits behind the VPN and one admin password.
package web

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/config"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/ledger"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/mover"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/notify"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/scheduler"
)

//go:embed templates/*.html
var templateFS embed.FS

//go:embed static/*
var staticFS embed.FS

const (
	sessionCookie = "archiver_session"
	sessionTTL    = 12 * time.Hour
)

type Server struct {
	Cfg    *config.Config
	Ledger *ledger.Ledger
	Mover  *mover.Mover
	Runner *mover.Runner
	Sched  *scheduler.Scheduler
	Log    *slog.Logger

	mu       sync.Mutex
	sessions map[string]time.Time
	pages    map[string]*template.Template
}

var funcs = template.FuncMap{
	"bytes": notify.Bytes,
	"when": func(t time.Time) string {
		if t.IsZero() {
			return "—"
		}
		return t.UTC().Format("2006-01-02 15:04 UTC")
	},
	"usd": func(f float64) string { return fmt.Sprintf("$%.2f", f) },
	"gb":  func(n int64) float64 { return float64(n) / 1e9 },
}

func (s *Server) Handler() (http.Handler, error) {
	s.sessions = map[string]time.Time{}
	s.pages = map[string]*template.Template{}
	for _, p := range []string{"login", "dashboard", "buckets", "runs", "archive", "audit"} {
		t, err := template.New("").Funcs(funcs).ParseFS(templateFS, "templates/layout.html", "templates/"+p+".html")
		if err != nil {
			return nil, fmt.Errorf("parse %s template: %w", p, err)
		}
		s.pages[p] = t
	}
	static, _ := fs.Sub(staticFS, "static")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServerFS(static)))
	mux.HandleFunc("GET /login", s.loginPage)
	mux.HandleFunc("POST /login", s.login)
	mux.HandleFunc("POST /logout", s.auth(s.logout))

	mux.HandleFunc("GET /{$}", s.auth(s.dashboard))
	mux.HandleFunc("POST /schedule/{action}", s.auth(s.schedule))

	mux.HandleFunc("GET /buckets", s.auth(s.buckets))
	mux.HandleFunc("POST /buckets/{name}/{action}", s.auth(s.bucketAction))

	mux.HandleFunc("GET /runs", s.auth(s.runs))
	mux.HandleFunc("GET /runs/table", s.auth(s.runsTable))
	mux.HandleFunc("POST /runs/cancel", s.auth(s.cancelRun))

	mux.HandleFunc("GET /archive", s.auth(s.archive))
	mux.HandleFunc("GET /archive/results", s.auth(s.archiveResults))
	mux.HandleFunc("POST /archive/restore", s.auth(s.restore))

	mux.HandleFunc("GET /audit", s.auth(s.audit))
	return securityHeaders(mux), nil
}

func securityHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'")
		h.ServeHTTP(w, r)
	})
}

// ── Auth ──────────────────────────────────────────────────────────────────

func (s *Server) auth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.validSession(r) {
			if r.Header.Get("HX-Request") == "true" {
				w.Header().Set("HX-Redirect", "/login")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}
		// Every state change comes from htmx, which sets this header. A cross-site form
		// can't, so this plus the SameSite=Strict cookie stops CSRF.
		if r.Method == http.MethodPost && r.Header.Get("HX-Request") != "true" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		h(w, r)
	}
}

func (s *Server) validSession(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.sessions[c.Value]
	if !ok || time.Now().After(exp) {
		delete(s.sessions, c.Value)
		return false
	}
	return true
}

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, "login", map[string]any{"Title": "Sign in"})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	pw := r.FormValue("password")
	if s.Cfg.AdminPasswordHash == "" || bcrypt.CompareHashAndPassword([]byte(s.Cfg.AdminPasswordHash), []byte(pw)) != nil {
		s.record(r, "login failed", "")
		time.Sleep(time.Second) // slow down guessing
		w.WriteHeader(http.StatusUnauthorized)
		s.render(w, "login", map[string]any{"Title": "Sign in", "Error": "That password is wrong."})
		return
	}
	buf := make([]byte, 32)
	rand.Read(buf)
	token := hex.EncodeToString(buf)
	s.mu.Lock()
	s.sessions[token] = time.Now().Add(sessionTTL)
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", HttpOnly: true,
		Secure: s.Cfg.CookieSecure, SameSite: http.SameSiteStrictMode, MaxAge: int(sessionTTL.Seconds()),
	})
	s.record(r, "login", "")
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.mu.Lock()
		delete(s.sessions, c.Value)
		s.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	w.Header().Set("HX-Redirect", "/login")
}

func (s *Server) record(r *http.Request, action, detail string) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if err := s.Ledger.Audit(r.Context(), "admin@"+host, action, detail); err != nil {
		s.log().Error("audit", "err", err)
	}
}

// ── Dashboard ─────────────────────────────────────────────────────────────

type bucketView struct {
	ledger.Bucket
	Scanned       bool
	ScannedAt     time.Time
	S3Bytes       int64
	S3Objects     int64
	EligibleBytes int64
	Eligible      int64
	AwaitDelete   ledger.StateTotal
	Archived      ledger.StateTotal
	Failed        int64
	EgressUSD     float64
	SavingUSD     float64
}

func (s *Server) bucketViews(ctx context.Context) ([]bucketView, error) {
	bs, err := s.Ledger.Buckets(ctx)
	if err != nil {
		return nil, err
	}
	var out []bucketView
	for _, b := range bs {
		if _, ok := s.Cfg.Bucket(b.Name); !ok {
			continue // dropped from the buckets file; its history stays in the ledger
		}
		v := bucketView{Bucket: b}
		if run, ok, err := s.Ledger.LastScan(ctx, b.Name); err != nil {
			return nil, err
		} else if ok {
			v.Scanned, v.ScannedAt = true, run.FinishedAt
			v.S3Bytes, v.S3Objects = run.ScannedBytes, run.Scanned
			v.EligibleBytes, v.Eligible = run.EligibleBytes, run.Eligible
		}
		t, err := s.Ledger.Totals(ctx, b.Name)
		if err != nil {
			return nil, err
		}
		v.AwaitDelete, v.Archived, v.Failed = t[ledger.StateCopied], t[ledger.StateDeleted], t[ledger.StateFailed].Objects
		v.EgressUSD = float64(v.EligibleBytes) / 1e9 * s.Cfg.EgressUSDPerGB
		v.SavingUSD = float64(v.Archived.Bytes) / 1e9 * s.Cfg.S3USDPerGBMonth
		out = append(out, v)
	}
	return out, nil
}

func (s *Server) common(ctx context.Context, title string) map[string]any {
	busy, label := s.Runner.Busy()
	return map[string]any{
		"Title":      title,
		"Busy":       busy,
		"BusyLabel":  label,
		"Paused":     s.Sched.Paused(ctx),
		"NextRun":    s.Sched.Next(),
		"BoxReady":   s.Cfg.BoxConfigured(),
		"MinAgeDays": int(s.Cfg.MinAge.Hours() / 24),
	}
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	views, err := s.bucketViews(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	var saving float64
	var archived int64
	for _, v := range views {
		saving += v.SavingUSD
		archived += v.Archived.Bytes
	}
	d := s.common(r.Context(), "Dashboard")
	d["Buckets"], d["SavingUSD"], d["ArchivedBytes"] = views, saving, archived
	s.render(w, "dashboard", d)
}

func (s *Server) schedule(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	if action != "pause" && action != "resume" {
		http.NotFound(w, r)
		return
	}
	if err := s.Sched.SetPaused(r.Context(), action == "pause"); err != nil {
		s.fail(w, err)
		return
	}
	s.record(r, "schedule "+action, "")
	w.Header().Set("HX-Refresh", "true")
}

// ── Buckets ───────────────────────────────────────────────────────────────

func (s *Server) buckets(w http.ResponseWriter, r *http.Request) {
	s.renderBuckets(w, r, "", "")
}

func (s *Server) renderBuckets(w http.ResponseWriter, r *http.Request, flash, flashErr string) {
	views, err := s.bucketViews(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	d := s.common(r.Context(), "Buckets")
	d["Buckets"], d["Flash"], d["FlashErr"] = views, flash, flashErr
	if r.Header.Get("HX-Request") == "true" {
		s.renderBlock(w, "buckets", "bucket-table", d)
		return
	}
	s.render(w, "buckets", d)
}

func (s *Server) bucketAction(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	name, action := r.PathValue("name"), r.PathValue("action")
	if _, ok := s.Cfg.Bucket(name); !ok {
		http.NotFound(w, r)
		return
	}
	var err error
	var flash string
	switch action {
	case "enable", "disable":
		err = s.Ledger.SetBucket(ctx, name, "enabled", action == "enable")
		flash = name + " " + action + "d."
	case "arm", "disarm":
		err = s.Ledger.SetBucket(ctx, name, "armed", action == "arm")
		flash = name + " " + action + "ed."
	case "unblock":
		err = s.Ledger.Unblock(ctx, name)
		flash = "Deletes on " + name + " are allowed again."
	case "dry-run", "run":
		mode := mover.ModeDry
		if action == "run" {
			mode = mover.ModeLive
			// Check up front so the operator sees why, instead of a failed run.
			b, berr := s.Ledger.Bucket(ctx, name)
			switch {
			case berr != nil:
				err = berr
			case !b.Enabled || !b.Armed:
				err = errors.New(name + " must be enabled and armed for a live run")
			case !s.Cfg.BoxConfigured():
				err = errors.New("the Storage Box isn't configured; only dry runs are possible")
			}
		}
		if err == nil {
			err = s.Runner.Start(name, mode, "manual")
		}
		flash = "Started a " + mode + " run of " + name + ". Follow it on the Runs page."
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		s.renderBuckets(w, r, "", err.Error())
		return
	}
	s.record(r, "bucket "+action, name)
	s.renderBuckets(w, r, flash, "")
}

// ── Runs ──────────────────────────────────────────────────────────────────

func (s *Server) runsData(ctx context.Context) (map[string]any, error) {
	runs, err := s.Ledger.Runs(ctx, 50)
	if err != nil {
		return nil, err
	}
	d := s.common(ctx, "Runs")
	d["Runs"] = runs
	return d, nil
}

func (s *Server) runs(w http.ResponseWriter, r *http.Request) {
	d, err := s.runsData(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	s.render(w, "runs", d)
}

func (s *Server) runsTable(w http.ResponseWriter, r *http.Request) {
	d, err := s.runsData(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	s.renderBlock(w, "runs", "runs-table", d)
}

func (s *Server) cancelRun(w http.ResponseWriter, r *http.Request) {
	if s.Runner.Cancel() {
		s.record(r, "run cancel", "")
	}
	s.runsTable(w, r)
}

// ── Archive ───────────────────────────────────────────────────────────────

func (s *Server) archive(w http.ResponseWriter, r *http.Request) {
	d := s.common(r.Context(), "Archive")
	d["Names"] = s.bucketNames()
	d["Bucket"], d["Q"] = r.URL.Query().Get("bucket"), r.URL.Query().Get("q")
	s.render(w, "archive", d)
}

func (s *Server) archiveResults(w http.ResponseWriter, r *http.Request) {
	s.renderResults(w, r, r.URL.Query().Get("bucket"), r.URL.Query().Get("q"), "", "")
}

func (s *Server) renderResults(w http.ResponseWriter, r *http.Request, bucket, q, flash, flashErr string) {
	d := map[string]any{"Flash": flash, "FlashErr": flashErr, "Q": q, "Bucket": bucket}
	if strings.TrimSpace(q) == "" {
		d["Prompt"] = true
	} else {
		objs, err := s.Ledger.Search(r.Context(), bucket, q, 100)
		if err != nil {
			s.fail(w, err)
			return
		}
		d["Objects"] = objs
	}
	s.renderBlock(w, "archive", "results", d)
}

func (s *Server) restore(w http.ResponseWriter, r *http.Request) {
	bucket, key := r.FormValue("bucket"), r.FormValue("key")
	q, filter := r.FormValue("q"), r.FormValue("filter")
	if _, ok := s.Cfg.Bucket(bucket); !ok {
		http.NotFound(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	if err := s.Mover.Restore(ctx, bucket, key); err != nil {
		s.record(r, "restore failed", bucket+"/"+key+": "+err.Error())
		s.renderResults(w, r, filter, q, "", err.Error())
		return
	}
	s.record(r, "restore", bucket+"/"+key)
	s.renderResults(w, r, filter, q, "Restored "+key+" to S3.", "")
}

// ── Audit ─────────────────────────────────────────────────────────────────

func (s *Server) audit(w http.ResponseWriter, r *http.Request) {
	entries, err := s.Ledger.AuditLog(r.Context(), 200)
	if err != nil {
		s.fail(w, err)
		return
	}
	d := s.common(r.Context(), "Audit log")
	d["Entries"] = entries
	s.render(w, "audit", d)
}

// ── Rendering ─────────────────────────────────────────────────────────────

func (s *Server) bucketNames() []string {
	var out []string
	for _, b := range s.Cfg.Buckets {
		out = append(out, b.Name)
	}
	return out
}

func (s *Server) render(w http.ResponseWriter, page string, data any) {
	s.renderBlock(w, page, "layout", data)
}

func (s *Server) renderBlock(w http.ResponseWriter, page, block string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.pages[page].ExecuteTemplate(w, block, data); err != nil {
		s.log().Error("render", "page", page, "block", block, "err", err)
	}
}

func (s *Server) fail(w http.ResponseWriter, err error) {
	s.log().Error("request failed", "err", err)
	http.Error(w, "Something went wrong; the error is in the archiver log.", http.StatusInternalServerError)
}

func (s *Server) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}
