---
title: ally-archiver — S3 to Storage Box Archiver
tags: [repo, ally-archiver, go, htmx, storage, s3, hetzner, ops]
summary: A small Go + htmx internal app that weekly copies private S3 objects older than 30 days to a Hetzner Storage Box, verifies them by SHA-256, deletes them from S3 one run later, and restores on demand.
last_reconciled: 2026-10-28
---

# ally-archiver — S3 to Storage Box Archiver

`ally-archiver/` in the `ally-platform` monorepo is an internal operations tool. It runs the
weekly move described in [Storage Archive](../platform/storage-archive.md). The page that records
the plan and its decisions is that one; this page covers the app. Tracking issue: [ally-platform#116](https://github.com/HelloAllyTech/ally-platform/issues/116).

It runs as one Go binary under systemd on the smallest Hetzner Cloud VM, reachable only over the
WireGuard VPN. There is no JS build: htmx is vendored and embedded with the templates.

## Commands

| Command | What it does |
|---|---|
| `archiver serve` | Web UI plus the weekly scheduler |
| `archiver inventory` | Lists every configured bucket: object count, bytes, and bytes older than the cutoff, with an egress-cost estimate. Read-only. |
| `archiver run --bucket <name> [--dry-run]` | Runs one bucket's pass now |
| `archiver restore --bucket <name> --key <key>` | Copies an archived object back to its original S3 key |

## Layout

| Package | Responsibility |
|---|---|
| `cmd/archiver` | Entry point and subcommands |
| `internal/config` | Env settings and the bucket list |
| `internal/source` | S3 via aws-sdk-go-v2: list, stream, delete including versions |
| `internal/box` | SFTP to the Storage Box: atomic `.part` upload and rename, remote `sha256sum` |
| `internal/ledger` | SQLite (pure-Go driver). Tables: objects, runs, buckets, audit. |
| `internal/mover` | The plan → copy → verify → delete state machine |
| `internal/scheduler` | Weekly cron; pause and resume |
| `internal/web` | `net/http` + `html/template` + htmx pages: dashboard, runs, archive, buckets |
| `internal/notify` | Slack run summaries |

## Object states

`copied` → `deleted`, with `restored` after a restore and `failed` on a verify mismatch. An object
is deleted from S3 only in a run **after** the one that copied it, and only after its remote hash
is re-verified.

## Safety defaults

- New buckets start disabled and unarmed. A disabled bucket isn't touched. An armed bucket is the
  only kind that copies and deletes; an unarmed one only dry-runs.
- A run has a per-run byte cap and a rate limit, and only one runs at a time.
- A verify failure blocks deletes for that bucket until an operator clears it.
- After every run, the ledger database is backed up to the Storage Box.
- Every UI action, such as arming a bucket, a restore or a manual run, is written to the audit
  table.

## Configuration

All configuration comes from environment variables, written by Ansible from Vault on the VM. The
repo is public, so bucket names and credentials never appear in it. See `ally-archiver/README.md`
for the variable list.

## Testing

`go test ./...` runs the unit tests: the mover against in-memory fakes, the ledger, and the web
handlers. The CI workflow `test-ally-archiver.yml` runs them on any change under `ally-archiver/`.
