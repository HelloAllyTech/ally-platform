#!/bin/bash
# Launch Chromium from ally-dev VM, rendered on Mac via XQuartz
# Usage: ./ally-chrome.sh [url]

# Ensure XQuartz is running
if ! pgrep -q Xquartz; then
  open -a XQuartz
  sleep 2
fi

URL="${1:-}"
DISPLAY=:0 ssh -Y ally-dev "chromium --no-sandbox --disable-gpu --no-first-run --disable-default-apps $URL" &
echo "Chromium launched from ally-dev (PID $!)"
