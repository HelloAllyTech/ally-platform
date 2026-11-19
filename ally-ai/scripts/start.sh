#!/bin/bash
# Container entrypoint (Dockerfile CMD): the API and the transcription worker.
#
# Was a `bash -c "... & ... & wait -n"` one-liner. bash as PID 1 ignores
# SIGTERM unless it traps it, so on every deploy `docker stop` waited out its
# timeout and SIGKILLed both processes: a summary in progress was cut, and SQS
# hid its message for the rest of its 900s visibility timeout before anyone
# retried it. This forwards SIGTERM, so the worker drains (finishes what it
# can, puts the rest straight back on the queue) and uvicorn closes cleanly.
set -e

poetry run python scripts/migrate.py all
poetry run python scripts/sync_prompts.py

# `poetry run` execs python (no wrapper process), so these PIDs receive the
# signals directly.
poetry run python -m app.main &
APP_PID=$!
poetry run python -m app.core.queue.transcription_request_sqs_worker &
WORKER_PID=$!
echo "Started API (PID: $APP_PID), transcription worker (PID: $WORKER_PID)"

shutdown() {
    echo "Shutting down: forwarding SIGTERM to the API and the worker"
    kill -TERM "$APP_PID" "$WORKER_PID" 2>/dev/null || true
    wait "$APP_PID" "$WORKER_PID" 2>/dev/null || true
    exit 0
}
trap shutdown SIGTERM SIGINT

# Both are critical: whichever exits first takes the container down so Docker
# restarts it (the old `wait -n`). `|| true` keeps `set -e` from exiting before
# the cleanup below.
wait -n || true

echo "A critical process exited; stopping the other"
kill -TERM "$APP_PID" "$WORKER_PID" 2>/dev/null || true
wait "$APP_PID" "$WORKER_PID" 2>/dev/null || true
exit 1
