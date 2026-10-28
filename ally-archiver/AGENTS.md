# ally-archiver — start here

A Go + htmx internal tool that moves private S3 objects older than 30 days to a Hetzner Storage
Box every week. Go 1.26, a single binary, a SQLite ledger, no JS build.

This file is a **router**: find your task below and read what it points at.

| If you are… | Read |
|---|---|
| Changing what moves, or why | [Storage Archive](https://tech.helloally.ai/#/wiki/platform/storage-archive.md). The plan and its decisions live there; update it. |
| Changing the app | [ally-archiver](https://tech.helloally.ai/#/wiki/repos/ally-archiver.md) and `README.md` (config, IAM) |
| Deploying it | The `ally_archiver` role and `terraform/hetzner-cloud/` in the infra repo |
| Tracking progress | Issue [#116](https://github.com/HelloAllyTech/ally-platform/issues/116) |

## Invariants

- Nothing leaves S3 in the run that copied it. A delete needs a re-verified SHA-256 on the box and
  an unchanged object on S3.
- A verify failure blocks deletes on the bucket until an operator allows them again.
- New buckets start disabled and unarmed. Only an armed bucket can copy or delete.
- No bucket names, hosts, regions or keys in the repo: it is public. They come from env.
- Every UI action is written to the audit table. Every POST requires `HX-Request: true`, which is
  the CSRF guard.

## Commands

```bash
go test -race ./...          # unit tests and an in-process SFTP server
ARCHIVER_IT_S3=1 AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test go test ./internal/source/
go run ./cmd/archiver serve  # see README.md for env
```
