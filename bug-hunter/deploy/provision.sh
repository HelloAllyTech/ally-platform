#!/usr/bin/env bash
# Sets up Bug Hunter v2 inside its container (Ubuntu 24.04). Run as root in the
# container, once, then again after a change to this file (it is idempotent).
#
#   incus exec bughunter -- bash /root/provision.sh
#
# What it does NOT do: secrets. Write /etc/bug-hunter/env and the GitHub App key by
# hand afterwards (deploy/README.md lists both); nothing secret lives in this repo.
set -euo pipefail
# Run from a folder every user can read: steps run as bughunter (Poetry) fail in /root.
cd /

REPO_URL=https://github.com/HelloAllyTech/ally-platform.git
CHECKOUT=/opt/ally-platform
VENV=/opt/bug-hunter/venv
HOME_DIR=/var/lib/bug-hunter

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git gnupg python3.12 python3.12-venv \
  postgresql-client util-linux

# Docker (the per-app test sandboxes) from Docker's own apt repository.
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin
fi

# gh: draft PRs, and git's credential helper for pushes (reads GH_TOKEN).
if ! command -v gh >/dev/null; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli.gpg
  echo "deb [signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt-get update -q
  apt-get install -y -q gh
fi

id bughunter >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash bughunter
usermod -aG docker bughunter
install -d -o bughunter -g bughunter -m 0750 "$HOME_DIR" /opt/bug-hunter
install -d -o root -g bughunter -m 0750 /etc/bug-hunter

# The checkout the agent reads and makes worktrees from. Public repo: fetch needs no auth.
if [ ! -d "$CHECKOUT/.git" ]; then
  install -d -o bughunter -g bughunter "$CHECKOUT"
  sudo -H -u bughunter git clone --quiet "$REPO_URL" "$CHECKOUT"
fi
sudo -H -u bughunter git -C "$CHECKOUT" fetch --quiet origin master
sudo -H -u bughunter git -C "$CHECKOUT" checkout --quiet --detach origin/master
sudo -H -u bughunter git -C "$CHECKOUT" config user.name "Bug Hunter"
sudo -H -u bughunter git -C "$CHECKOUT" config user.email "bug-hunter@users.noreply.github.com"
sudo -H -u bughunter gh auth setup-git --hostname github.com 2>/dev/null || \
  sudo -H -u bughunter git config --global credential.https://github.com.helper '!gh auth git-credential'

# The package from poetry.lock, editable (config/ and prompts/ are read from the
# checkout), with the VM extra (CloudWatch). Poetry itself lives in its own venv.
[ -x /opt/bug-hunter/poetry/bin/poetry ] || {
  sudo -H -u bughunter python3.12 -m venv /opt/bug-hunter/poetry
  sudo -H -u bughunter /opt/bug-hunter/poetry/bin/pip install --quiet "poetry>=2,<3"
}
[ -x "$VENV/bin/python" ] || sudo -H -u bughunter python3.12 -m venv "$VENV"
sudo -H -u bughunter env VIRTUAL_ENV="$VENV" PATH="$VENV/bin:$PATH" \
  /opt/bug-hunter/poetry/bin/poetry -C "$CHECKOUT/bug-hunter" install --only main --extras vm --no-interaction

# systemd units: daily job, 15-minute poll, worker. Installed, not enabled: enable them
# once /etc/bug-hunter/env and the database are in place (deploy/README.md).
install -m 0644 "$CHECKOUT"/bug-hunter/deploy/bug-hunter-*.service \
  "$CHECKOUT"/bug-hunter/deploy/bug-hunter-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now docker
echo "provisioned. Next: /etc/bug-hunter/env, the App key, 'bug-hunter config check'."
