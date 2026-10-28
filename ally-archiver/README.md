# ally-archiver

Moves private S3 objects older than 30 days to a Hetzner Storage Box, every week. The app copies
each object over SFTP, verifies it by SHA-256, and deletes it from S3 in the following run. An
operator restores objects from the UI when they are needed.

- Plan and decisions: [Storage Archive](https://tech.helloally.ai/#/wiki/platform/storage-archive.md)
- App reference: [ally-archiver](https://tech.helloally.ai/#/wiki/repos/ally-archiver.md)
- Tracking issue: [#116](https://github.com/HelloAllyTech/ally-platform/issues/116)

## Run it locally

```bash
go test ./...                                  # unit tests; no services needed
echo 'a long password' | go run ./cmd/archiver hash-password

export ARCHIVER_BUCKETS_FILE=buckets.json      # see below
export ARCHIVER_ADMIN_PASSWORD_HASH='<hash>'
go run ./cmd/archiver inventory                # read-only: sizes, eligible bytes, egress cost
go run ./cmd/archiver serve                    # UI on 127.0.0.1:8080
```

Against LocalStack, set `AWS_ENDPOINT_URL=http://localhost:4566`, `AWS_ACCESS_KEY_ID=test`,
`AWS_SECRET_ACCESS_KEY=test` and `ARCHIVER_S3_PATH_STYLE=true`. The S3 integration test runs when
`ARCHIVER_IT_S3=1`.

Without the Storage Box settings, only dry runs and inventory work.

## Commands

| Command | Does |
|---|---|
| `serve` | UI and the weekly schedule |
| `inventory` | Dry run over every configured bucket; prints a table |
| `run -bucket NAME [-dry-run]` | One pass now. A live pass needs the bucket enabled and armed in the UI. |
| `restore -bucket NAME -key KEY` | Copies an archived object back to its S3 key |
| `hash-password` | Reads a password on stdin and prints its bcrypt hash |

## Configuration

The deploy env is written by Ansible from Vault. The repo is public, so real bucket names, hosts
and keys never go in it.

| Variable | Default | Meaning |
|---|---|---|
| `ARCHIVER_LISTEN` | `127.0.0.1:8080` | Set to the VM's wg0 address so the UI is reachable only over the VPN |
| `ARCHIVER_DB` | `archiver.db` | SQLite ledger |
| `ARCHIVER_BUCKETS_FILE` | — | JSON list of buckets (below) |
| `ARCHIVER_MIN_AGE_DAYS` | `30` | Objects older than this are archived |
| `ARCHIVER_SCHEDULE` | `0 2 * * 0` | Cron spec in UTC (Sunday 02:00) |
| `ARCHIVER_MAX_BYTES_PER_RUN` | `107374182400` (100 GiB) | Copy cap per bucket per run; `0` means no cap |
| `ARCHIVER_RATE_BYTES_PER_SEC` | `0` | Read throttle shared by all workers; `0` means unthrottled |
| `ARCHIVER_WORKERS` | `4` | Parallel copies |
| `ARCHIVER_S3_PATH_STYLE` | `false` | `true` for LocalStack |
| `ARCHIVER_BOX_ADDR` | — | Storage Box `host:23` |
| `ARCHIVER_BOX_USER` | — | Storage Box sub-account |
| `ARCHIVER_BOX_KEY_FILE` | — | SSH private key |
| `ARCHIVER_BOX_KNOWN_HOSTS` | — | known_hosts with the box's host key; there is no trust-on-first-use |
| `ARCHIVER_BOX_ROOT` | `ally-archive` | Directory on the box |
| `ARCHIVER_BOX_HASH` | `remote` | `remote` runs `sha256sum` on the box; `download` reads the file back |
| `ARCHIVER_ADMIN_PASSWORD_HASH` | — | bcrypt hash; `serve` won't start without it |
| `ARCHIVER_COOKIE_SECURE` | `false` | `true` if the UI is served over HTTPS |
| `ARCHIVER_SLACK_WEBHOOK_URL` | — | Weekly summary; bucket names are left out |
| `ARCHIVER_EGRESS_USD_PER_GB` | `0.09` | For the backfill cost estimate |
| `ARCHIVER_S3_USD_PER_GB_MONTH` | `0.025` | For the saving estimate |

AWS credentials come from the default chain (`AWS_ACCESS_KEY_ID` and so on). A bucket with its own
credentials names the env vars that hold them:

```json
[
  {"name": "<agent-trace bucket>", "region": "<region>"},
  {"name": "<recordings bucket>", "region": "<region>",
   "access_key_id_env": "RECORDINGS_AWS_ACCESS_KEY_ID",
   "secret_access_key_env": "RECORDINGS_AWS_SECRET_ACCESS_KEY"}
]
```

A new bucket starts **disabled and unarmed**. Dry-run it, check the egress estimate, then enable
and arm it in the UI.

## How a pass works

1. **Delete** what earlier runs copied: re-verify the box hash, check that S3 still holds the same
   object (by ETag and size), then delete every version. A failed verify blocks deletes on that
   bucket until an operator allows them again.
2. **Copy** each object older than the cutoff that isn't already archived: stream it to a `.part`
   file, rename it into place, verify the hash on the box, and record it as `copied`.
3. **Back up** the ledger to `<root>/_ledger/` on the box.

## IAM

The archiver's IAM user needs, on the in-scope buckets only: `s3:ListBucket`,
`s3:ListBucketVersions`, `s3:GetObject`, `s3:GetObjectVersion`, `s3:PutObject` (for restores),
`s3:DeleteObject` and `s3:DeleteObjectVersion`.
