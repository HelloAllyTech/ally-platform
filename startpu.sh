#!/bin/bash
set -e

echo "Starting application services..."

# Sync prompts to ally-be (runs at deployment; non-fatal if ally-be unreachable)
echo "Syncing prompts to ally-be..."
python scripts/sync_prompts.py || echo "Prompt sync failed (continuing with local prompts)."

# Start uvicorn in background
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
UVICORN_PID=$!

# Start worker in background
python -m app.worker start &
WORKER_PID=$!

echo "Started uvicorn (PID: $UVICORN_PID) and worker (PID: $WORKER_PID)"

shutdown() {
    echo "Shutting down services..."
    kill $UVICORN_PID $WORKER_PID 2>/dev/null || true
    wait $UVICORN_PID $WORKER_PID 2>/dev/null || true
    exit 0
}

trap shutdown SIGTERM SIGINT

wait -n

echo "One service exited, shutting down remaining services..."
kill $UVICORN_PID $WORKER_PID 2>/dev/null || true
wait $UVICORN_PID $WORKER_PID 2>/dev/null || true

exit 1
