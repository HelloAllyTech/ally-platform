#!/bin/sh
# Bring the VM's checkout to origin/master. Run as root by the daily job before each
# night's sweep (bug-hunter-daily.service, ExecStartPre=+), so the sweep and the
# worker run what is on master:
#   - checkout:  detached at origin/master (the VM never commits here)
#   - packages:  `poetry install` only when the lockfile or pyproject changed
#   - units:     reinstalled and reloaded only when deploy/ changed
#   - worker:    not touched; it sees the new commit between bugs and exits, and
#                systemd (Restart=always) starts it on the new code. A paid run in
#                progress is never cut short.
set -eu
CHECKOUT=${BUGHUNTER_CHECKOUT:-/opt/ally-platform}
VENV=/opt/bug-hunter/venv
as_bh() { runuser -u bughunter -- "$@"; }

as_bh git -C "$CHECKOUT" fetch --quiet origin master
old=$(as_bh git -C "$CHECKOUT" rev-parse HEAD)
new=$(as_bh git -C "$CHECKOUT" rev-parse origin/master)
if [ "$old" = "$new" ]; then
  echo "update: already at ${new%"${new#?????????}"}"
  exit 0
fi
as_bh git -C "$CHECKOUT" checkout --quiet --detach "$new"
echo "update: ${old%"${old#?????????}"} -> ${new%"${new#?????????}"}"

changed() { ! as_bh git -C "$CHECKOUT" diff --quiet "$old" "$new" -- "$@"; }

if changed bug-hunter/poetry.lock bug-hunter/pyproject.toml; then
  as_bh env VIRTUAL_ENV="$VENV" PATH="$VENV/bin:$PATH" \
    /opt/bug-hunter/poetry/bin/poetry -C "$CHECKOUT/bug-hunter" \
    install --only main --extras vm --no-interaction
  echo "update: packages installed"
fi
if changed bug-hunter/deploy; then
  install -m 0644 "$CHECKOUT"/bug-hunter/deploy/bug-hunter-*.service \
    "$CHECKOUT"/bug-hunter/deploy/bug-hunter-*.timer /etc/systemd/system/
  systemctl daemon-reload
  echo "update: units reinstalled"
fi
