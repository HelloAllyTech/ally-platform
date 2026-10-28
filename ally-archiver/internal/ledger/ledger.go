// Package ledger is the archiver's record of every object it has touched, every run, and
// every operator action. It is the only record of where an archived object lives.
package ledger

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

// Object states.
const (
	StateCopied   = "copied"   // on the box and verified; still on S3 until a later run
	StateDeleted  = "deleted"  // deleted from S3; the box holds the only copy
	StateRestored = "restored" // copied back to S3 from the box
	StateFailed   = "failed"   // copy or verify failed; see Error
)

type Ledger struct {
	db *sql.DB
}

func Open(path string) (*Ledger, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	// One writer: SQLite serialises writes anyway, and this keeps the run workers from
	// tripping over SQLITE_BUSY.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &Ledger{db: db}, nil
}

func (l *Ledger) Close() error { return l.db.Close() }

// Backup writes a consistent copy of the database to path.
func (l *Ledger) Backup(ctx context.Context, path string) error {
	_, err := l.db.ExecContext(ctx, "VACUUM INTO ?", path)
	return err
}

// ── Buckets ───────────────────────────────────────────────────────────────

type Bucket struct {
	Name          string
	Enabled       bool
	Armed         bool
	BlockedReason string
	UpdatedAt     time.Time
}

// SyncBuckets adds any bucket from the buckets file the ledger hasn't seen, disabled and
// unarmed. Existing rows keep their state.
func (l *Ledger) SyncBuckets(ctx context.Context, names []string) error {
	for _, n := range names {
		if _, err := l.db.ExecContext(ctx,
			`INSERT INTO buckets(name, enabled, armed, blocked_reason, updated_at) VALUES(?, 0, 0, '', ?)
			 ON CONFLICT(name) DO NOTHING`, n, now()); err != nil {
			return err
		}
	}
	return nil
}

func (l *Ledger) Buckets(ctx context.Context) ([]Bucket, error) {
	rows, err := l.db.QueryContext(ctx, `SELECT name, enabled, armed, blocked_reason, updated_at FROM buckets ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Bucket
	for rows.Next() {
		var b Bucket
		var updated int64
		if err := rows.Scan(&b.Name, &b.Enabled, &b.Armed, &b.BlockedReason, &updated); err != nil {
			return nil, err
		}
		b.UpdatedAt = time.Unix(updated, 0)
		out = append(out, b)
	}
	return out, rows.Err()
}

func (l *Ledger) Bucket(ctx context.Context, name string) (Bucket, error) {
	var b Bucket
	var updated int64
	err := l.db.QueryRowContext(ctx, `SELECT name, enabled, armed, blocked_reason, updated_at FROM buckets WHERE name = ?`, name).
		Scan(&b.Name, &b.Enabled, &b.Armed, &b.BlockedReason, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return b, fmt.Errorf("unknown bucket %q", name)
	}
	b.UpdatedAt = time.Unix(updated, 0)
	return b, err
}

// SetBucket changes one flag: "enabled" or "armed". Disabling also disarms.
func (l *Ledger) SetBucket(ctx context.Context, name, flag string, on bool) error {
	var q string
	switch {
	case flag == "enabled" && on:
		q = `UPDATE buckets SET enabled = 1, updated_at = ? WHERE name = ?`
	case flag == "enabled":
		q = `UPDATE buckets SET enabled = 0, armed = 0, updated_at = ? WHERE name = ?`
	case flag == "armed" && on:
		q = `UPDATE buckets SET armed = 1, updated_at = ? WHERE name = ? AND enabled = 1`
	case flag == "armed":
		q = `UPDATE buckets SET armed = 0, updated_at = ? WHERE name = ?`
	default:
		return fmt.Errorf("unknown bucket flag %q", flag)
	}
	res, err := l.db.ExecContext(ctx, q, now(), name)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		if flag == "armed" && on {
			return fmt.Errorf("bucket %q must be enabled before it can be armed", name)
		}
		return fmt.Errorf("unknown bucket %q", name)
	}
	return nil
}

// Block stops deletes on a bucket until an operator clears it.
func (l *Ledger) Block(ctx context.Context, name, reason string) error {
	_, err := l.db.ExecContext(ctx, `UPDATE buckets SET blocked_reason = ?, updated_at = ? WHERE name = ?`, reason, now(), name)
	return err
}

func (l *Ledger) Unblock(ctx context.Context, name string) error {
	return l.Block(ctx, name, "")
}

// ── Objects ───────────────────────────────────────────────────────────────

type Object struct {
	Bucket         string
	Key            string
	Size           int64
	SHA256         string
	ETag           string
	S3LastModified time.Time
	RemotePath     string
	State          string
	CopiedRun      int64
	CopiedAt       time.Time
	DeletedAt      time.Time
	RestoredAt     time.Time
	Error          string
}

const objectCols = `bucket, key, size, sha256, etag, s3_last_modified, remote_path, state, copied_run, copied_at, deleted_at, restored_at, error`

func scanObject(s interface{ Scan(...any) error }) (Object, error) {
	var o Object
	var lm, ca, da, ra int64
	err := s.Scan(&o.Bucket, &o.Key, &o.Size, &o.SHA256, &o.ETag, &lm, &o.RemotePath, &o.State, &o.CopiedRun, &ca, &da, &ra, &o.Error)
	o.S3LastModified, o.CopiedAt, o.DeletedAt, o.RestoredAt = unix(lm), unix(ca), unix(da), unix(ra)
	return o, err
}

// Object returns the ledger row for one key; ok is false when there is none.
func (l *Ledger) Object(ctx context.Context, bucket, key string) (Object, bool, error) {
	o, err := scanObject(l.db.QueryRowContext(ctx, `SELECT `+objectCols+` FROM objects WHERE bucket = ? AND key = ?`, bucket, key))
	if errors.Is(err, sql.ErrNoRows) {
		return Object{}, false, nil
	}
	return o, err == nil, err
}

func (l *Ledger) MarkCopied(ctx context.Context, o Object, runID int64) error {
	_, err := l.db.ExecContext(ctx, `
		INSERT INTO objects(`+objectCols+`) VALUES(?, ?, ?, ?, ?, ?, ?, 'copied', ?, ?, 0, 0, '')
		ON CONFLICT(bucket, key) DO UPDATE SET
			size = excluded.size, sha256 = excluded.sha256, etag = excluded.etag,
			s3_last_modified = excluded.s3_last_modified, remote_path = excluded.remote_path,
			state = 'copied', copied_run = excluded.copied_run, copied_at = excluded.copied_at,
			deleted_at = 0, error = ''`,
		o.Bucket, o.Key, o.Size, o.SHA256, o.ETag, o.S3LastModified.Unix(), o.RemotePath, runID, now())
	return err
}

func (l *Ledger) MarkFailed(ctx context.Context, bucket, key, remotePath, msg string, runID int64) error {
	_, err := l.db.ExecContext(ctx, `
		INSERT INTO objects(`+objectCols+`) VALUES(?, ?, 0, '', '', 0, ?, 'failed', ?, 0, 0, 0, ?)
		ON CONFLICT(bucket, key) DO UPDATE SET state = 'failed', copied_run = excluded.copied_run, error = excluded.error`,
		bucket, key, remotePath, runID, msg)
	return err
}

func (l *Ledger) MarkDeleted(ctx context.Context, bucket, key, note string) error {
	_, err := l.db.ExecContext(ctx, `UPDATE objects SET state = 'deleted', deleted_at = ?, error = ? WHERE bucket = ? AND key = ?`,
		now(), note, bucket, key)
	return err
}

func (l *Ledger) MarkRestored(ctx context.Context, bucket, key string) error {
	_, err := l.db.ExecContext(ctx, `UPDATE objects SET state = 'restored', restored_at = ? WHERE bucket = ? AND key = ?`,
		now(), bucket, key)
	return err
}

// SetError records a problem on an object without changing its state.
func (l *Ledger) SetError(ctx context.Context, bucket, key, msg string) error {
	_, err := l.db.ExecContext(ctx, `UPDATE objects SET error = ? WHERE bucket = ? AND key = ?`, msg, bucket, key)
	return err
}

// PendingDeletes are objects copied by an earlier run than runID and still on S3.
func (l *Ledger) PendingDeletes(ctx context.Context, bucket string, runID int64) ([]Object, error) {
	return l.queryObjects(ctx, `SELECT `+objectCols+` FROM objects WHERE bucket = ? AND state = 'copied' AND copied_run < ? ORDER BY key`, bucket, runID)
}

// Search finds objects by key prefix, newest copies first.
func (l *Ledger) Search(ctx context.Context, bucket, prefix string, limit int) ([]Object, error) {
	q := `SELECT ` + objectCols + ` FROM objects WHERE key LIKE ? ESCAPE '\'`
	args := []any{likePrefix(prefix)}
	if bucket != "" {
		q += ` AND bucket = ?`
		args = append(args, bucket)
	}
	q += ` ORDER BY copied_at DESC LIMIT ?`
	args = append(args, limit)
	return l.queryObjects(ctx, q, args...)
}

func (l *Ledger) queryObjects(ctx context.Context, q string, args ...any) ([]Object, error) {
	rows, err := l.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Object
	for rows.Next() {
		o, err := scanObject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

type StateTotal struct {
	Objects int64
	Bytes   int64
}

// Totals counts objects and bytes per state for one bucket.
func (l *Ledger) Totals(ctx context.Context, bucket string) (map[string]StateTotal, error) {
	rows, err := l.db.QueryContext(ctx, `SELECT state, COUNT(*), COALESCE(SUM(size), 0) FROM objects WHERE bucket = ? GROUP BY state`, bucket)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]StateTotal{}
	for rows.Next() {
		var s string
		var t StateTotal
		if err := rows.Scan(&s, &t.Objects, &t.Bytes); err != nil {
			return nil, err
		}
		out[s] = t
	}
	return out, rows.Err()
}

// ── Runs ──────────────────────────────────────────────────────────────────

type Run struct {
	ID            int64
	Bucket        string
	Mode          string // dry | live
	Trigger       string // schedule | manual | cli
	Status        string // running | done | failed | cancelled
	StartedAt     time.Time
	FinishedAt    time.Time
	Scanned       int64
	ScannedBytes  int64
	Eligible      int64
	EligibleBytes int64
	Copied        int64
	CopiedBytes   int64
	Deleted       int64
	DeletedBytes  int64
	Failed        int64
	Error         string
}

const runCols = `id, bucket, mode, trigger, status, started_at, finished_at, scanned, scanned_bytes, eligible, eligible_bytes, copied, copied_bytes, deleted, deleted_bytes, failed, error`

func scanRun(s interface{ Scan(...any) error }) (Run, error) {
	var r Run
	var st, fi int64
	err := s.Scan(&r.ID, &r.Bucket, &r.Mode, &r.Trigger, &r.Status, &st, &fi, &r.Scanned, &r.ScannedBytes,
		&r.Eligible, &r.EligibleBytes, &r.Copied, &r.CopiedBytes, &r.Deleted, &r.DeletedBytes, &r.Failed, &r.Error)
	r.StartedAt, r.FinishedAt = unix(st), unix(fi)
	return r, err
}

func (l *Ledger) StartRun(ctx context.Context, bucket, mode, trigger string) (int64, error) {
	res, err := l.db.ExecContext(ctx, `INSERT INTO runs(bucket, mode, trigger, status, started_at) VALUES(?, ?, ?, 'running', ?)`,
		bucket, mode, trigger, now())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// SaveRun writes a run's counters; the mover calls it as it goes so the UI sees progress.
func (l *Ledger) SaveRun(ctx context.Context, r Run) error {
	var fin int64
	if !r.FinishedAt.IsZero() {
		fin = r.FinishedAt.Unix()
	}
	_, err := l.db.ExecContext(ctx, `UPDATE runs SET status = ?, finished_at = ?, scanned = ?, scanned_bytes = ?,
		eligible = ?, eligible_bytes = ?, copied = ?, copied_bytes = ?, deleted = ?, deleted_bytes = ?, failed = ?, error = ?
		WHERE id = ?`,
		r.Status, fin, r.Scanned, r.ScannedBytes, r.Eligible, r.EligibleBytes, r.Copied, r.CopiedBytes,
		r.Deleted, r.DeletedBytes, r.Failed, r.Error, r.ID)
	return err
}

func (l *Ledger) Run(ctx context.Context, id int64) (Run, error) {
	return scanRun(l.db.QueryRowContext(ctx, `SELECT `+runCols+` FROM runs WHERE id = ?`, id))
}

func (l *Ledger) Runs(ctx context.Context, limit int) ([]Run, error) {
	rows, err := l.db.QueryContext(ctx, `SELECT `+runCols+` FROM runs ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Run
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// LastScan is the newest finished run of a bucket, whose scan counters describe what is on S3.
func (l *Ledger) LastScan(ctx context.Context, bucket string) (Run, bool, error) {
	r, err := scanRun(l.db.QueryRowContext(ctx,
		`SELECT `+runCols+` FROM runs WHERE bucket = ? AND status = 'done' ORDER BY id DESC LIMIT 1`, bucket))
	if errors.Is(err, sql.ErrNoRows) {
		return Run{}, false, nil
	}
	return r, err == nil, err
}

// FailOrphanRuns marks runs left "running" by a crash or restart as failed.
func (l *Ledger) FailOrphanRuns(ctx context.Context) error {
	_, err := l.db.ExecContext(ctx, `UPDATE runs SET status = 'failed', finished_at = ?, error = 'archiver restarted mid-run' WHERE status = 'running'`, now())
	return err
}

// ── Audit and settings ────────────────────────────────────────────────────

type AuditEntry struct {
	At     time.Time
	Actor  string
	Action string
	Detail string
}

func (l *Ledger) Audit(ctx context.Context, actor, action, detail string) error {
	_, err := l.db.ExecContext(ctx, `INSERT INTO audit(at, actor, action, detail) VALUES(?, ?, ?, ?)`, now(), actor, action, detail)
	return err
}

func (l *Ledger) AuditLog(ctx context.Context, limit int) ([]AuditEntry, error) {
	rows, err := l.db.QueryContext(ctx, `SELECT at, actor, action, detail FROM audit ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var e AuditEntry
		var at int64
		if err := rows.Scan(&at, &e.Actor, &e.Action, &e.Detail); err != nil {
			return nil, err
		}
		e.At = time.Unix(at, 0)
		out = append(out, e)
	}
	return out, rows.Err()
}

func (l *Ledger) Setting(ctx context.Context, key string) (string, error) {
	var v string
	err := l.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

func (l *Ledger) SetSetting(ctx context.Context, key, value string) error {
	_, err := l.db.ExecContext(ctx, `INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

func now() int64 { return time.Now().Unix() }

func unix(s int64) time.Time {
	if s == 0 {
		return time.Time{}
	}
	return time.Unix(s, 0)
}

func likePrefix(p string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(p) + "%"
}
