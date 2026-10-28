-- Idempotent: applied on every start. Add columns with new statements below, never by
-- editing these.

CREATE TABLE IF NOT EXISTS buckets (
    name           TEXT PRIMARY KEY,
    enabled        INTEGER NOT NULL DEFAULT 0,
    armed          INTEGER NOT NULL DEFAULT 0,
    blocked_reason TEXT    NOT NULL DEFAULT '',
    updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS objects (
    bucket           TEXT    NOT NULL,
    key              TEXT    NOT NULL,
    size             INTEGER NOT NULL,
    sha256           TEXT    NOT NULL,
    etag             TEXT    NOT NULL,
    s3_last_modified INTEGER NOT NULL,
    remote_path      TEXT    NOT NULL,
    state            TEXT    NOT NULL,
    copied_run       INTEGER NOT NULL,
    copied_at        INTEGER NOT NULL,
    deleted_at       INTEGER NOT NULL,
    restored_at      INTEGER NOT NULL,
    error            TEXT    NOT NULL,
    PRIMARY KEY (bucket, key)
);
CREATE INDEX IF NOT EXISTS objects_state ON objects (bucket, state, copied_run);

CREATE TABLE IF NOT EXISTS runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket         TEXT    NOT NULL,
    mode           TEXT    NOT NULL,
    trigger        TEXT    NOT NULL,
    status         TEXT    NOT NULL,
    started_at     INTEGER NOT NULL,
    finished_at    INTEGER NOT NULL DEFAULT 0,
    scanned        INTEGER NOT NULL DEFAULT 0,
    scanned_bytes  INTEGER NOT NULL DEFAULT 0,
    eligible       INTEGER NOT NULL DEFAULT 0,
    eligible_bytes INTEGER NOT NULL DEFAULT 0,
    copied         INTEGER NOT NULL DEFAULT 0,
    copied_bytes   INTEGER NOT NULL DEFAULT 0,
    deleted        INTEGER NOT NULL DEFAULT 0,
    deleted_bytes  INTEGER NOT NULL DEFAULT 0,
    failed         INTEGER NOT NULL DEFAULT 0,
    error          TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     INTEGER NOT NULL,
    actor  TEXT    NOT NULL,
    action TEXT    NOT NULL,
    detail TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
