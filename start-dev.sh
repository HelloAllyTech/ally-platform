#!/bin/bash
set -e

echo "Starting application services (dev mode with hot reload)..."

# Sync prompts to ally-be (non-fatal if unreachable)
echo "Syncing prompts to ally-be..."
poetry run python scripts/sync_prompts.py || echo "Prompt sync failed (continuing with local prompts)."

# Start uvicorn with --reload for hot reload
poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
UVICORN_PID=$!

# Start worker in background
poetry run python -m app.worker start &
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
