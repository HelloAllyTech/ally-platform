# Running Bug Hunter v2 on its machine

Bug Hunter v2 runs on its own machine on Ally's private network, never in GitHub Actions:
`ally-platform` is public, so Actions logs and artifacts would be too (chunk 08 notes).
The machine is an incus container with Docker inside (for the per-app test sandboxes),
next to, but not on, the production host.

Three systemd units do the work:

| Unit | When | What |
|---|---|---|
| `bug-hunter-daily.timer` → `.service` | 03:30 IST | `bug-hunter daily --with-lenses --max-cost-usd 3`: new commits, CI failures, issues and error logs, a dry run until the rollout says `--live`; then `approvals expire` |
| `bug-hunter-poll.timer` → `.service` | every 15 min | `daily --sources ci_failures,issues`, then `feedback` |
| `bug-hunter-worker.service` | always on | `bug-hunter worker`: runs queued bugs according to the mode (off, manual, autonomous) |

The daily job and the poll share one `flock`, so they never overlap.

## 1. The container

On the host (the container needs WireGuard on the private network to reach ally-be's
Postgres, like the other containers there: add it to the infra inventory):

```bash
incus launch images:ubuntu/24.04 bughunter -p default -p ally \
  -c security.nesting=true \
  -c security.syscalls.intercept.mknod=true \
  -c security.syscalls.intercept.setxattr=true \
  -c limits.cpu=4 -c limits.memory=16GiB
incus config device override bughunter root size=120GiB
incus file push bug-hunter/deploy/provision.sh bughunter/root/provision.sh
incus exec bughunter -- bash /root/provision.sh
```

`provision.sh` installs Docker, `gh`, Python 3.12 and Poetry; creates the `bughunter`
user; clones `ally-platform` to `/opt/ally-platform`; installs the package from
`poetry.lock` with the `vm` extra into `/opt/bug-hunter/venv`; and installs (but does
not enable) the units. Re-run it to update the code.

## 2. The database

The `bughunter` schema lives in ally-be's own database (user, 2026-11-16). Once, as the
database owner:

```bash
psql "$OWNER_URL" -f bug-hunter/db/ally-db-setup.sql
psql "$OWNER_URL" -c "ALTER ROLE bughunter PASSWORD '<new password>'"
psql "$OWNER_URL" -c "GRANT bughunter_dashboard TO <ally-be's login role>"
```

Then, in the container as `bughunter`: `bug-hunter db migrate`.

## 3. Secrets: `/etc/bug-hunter/env`

Owned by root, group `bughunter`, mode `0640`. Never committed, never printed.

| Variable | What |
|---|---|
| `BUGHUNTER_CHECKPOINT_DB_URL` | `postgresql://bughunter:…@<ally-be Postgres>/<db>` |
| `BUGHUNTER_GITHUB_APP_ID` | The Bug Hunter GitHub App's id |
| `BUGHUNTER_GITHUB_APP_KEY_FILE` | `/etc/bug-hunter/github-app.pem` (mode `0640`, group `bughunter`) |
| `BUGHUNTER_GITHUB_APP_INSTALLATION_ID` | Optional; looked up from the org when unset |
| `OPENAI_API_KEY`, `GOOGLE_API_KEY` | Model providers |
| `LANGSMITH_API_KEY`, `LANGSMITH_WORKSPACE_ID` | Tracing |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Read-only CloudWatch Logs (`logs:StartQuery`, `logs:GetQueryResults`, `logs:DescribeLogGroups`) |
| `BUGHUNTER_SPEND_BACKEND=db`, `BUGHUNTER_HOME=/var/lib/bug-hunter` | Ledger in the database; runs and caches on the container |

The GitHub token is not in this file: `github_app.py` mints an installation token from
the App key on each run and refreshes it before it expires (tokens last an hour).

## 4. The GitHub App

Org settings → Developer settings → GitHub Apps → New. No webhook. Repository
permissions: Contents read and write, Pull requests read and write, Issues read and
write, Actions read, Metadata read. Organization permissions: Members read. Install it
on `ally-platform` and `bug-hunter-reports` only. Contents write is for pushing
`bughunter/` branches (the code refuses any other branch, and master is protected);
issues are written only to the private reports repo (the code refuses a public one).

## 5. Turning it on

```bash
sudo -u bughunter /opt/bug-hunter/venv/bin/bug-hunter config check
sudo -u bughunter /opt/bug-hunter/venv/bin/bug-hunter daily --dry-run   # by hand once
systemctl enable --now bug-hunter-daily.timer bug-hunter-poll.timer
systemctl enable --now bug-hunter-worker.service   # once the mode is set on the dashboard
```

Rollout (chunk 08 notes): three days of dry runs, reviewing the plan files in
`/var/lib/bug-hunter/daily/`; then `--live` for ally-be only; then all apps. Kill
switch: `bug-hunter pause`.
