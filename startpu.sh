#!/bin/bash
set -e

echo "Starting application services..."

# Sync prompts to ally-be (runs at deployment; non-fatal if ally-be unreachable)
echo "Syncing prompts to ally-be..."
python scripts/sync_prompts.py || echo "Prompt sync failed (continuing with local prompts)."

# Start uvicorn in background
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
UVICORN_PID=$!

# Start the voice worker in background.
python -m app.worker start &
WORKER_PID=$!

echo "Started uvicorn (PID: $UVICORN_PID), worker (PID: $WORKER_PID)"

# Graceful shutdown.
shutdown() {
    echo "Shutting down services..."
    kill $UVICORN_PID $WORKER_PID 2>/dev/null || true
    wait $UVICORN_PID $WORKER_PID 2>/dev/null || true
    exit 0
}

trap shutdown SIGTERM SIGINT

# uvicorn and the worker are both critical: whichever exits first tears the
# container down so the orchestrator restarts it. `|| true` keeps `set -e` from
# exiting before the cleanup below.
wait -n || true

echo "A critical service exited, shutting down remaining services..."
kill $UVICORN_PID $WORKER_PID 2>/dev/null || true
wait $UVICORN_PID $WORKER_PID 2>/dev/null || true

exit 1
