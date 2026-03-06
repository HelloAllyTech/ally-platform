#!/bin/bash
set -e  # Exit on any error

echo "Starting application services..."

# Sync prompts to ally-be (runs at deployment; non-fatal if ally-be unreachable)
echo "Syncing prompts to ally-be..."
poetry run python scripts/sync_prompts.py || echo "Prompt sync failed (continuing with local prompts)."

# Start uvicorn in background
poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
UVICORN_PID=$!

# Start worker in background
poetry run python -m app.worker start &
WORKER_PID=$!

echo "Started uvicorn (PID: $UVICORN_PID) and worker (PID: $WORKER_PID)"

# Function to handle shutdown gracefully
shutdown() {
    echo "Shutting down services..."
    kill $UVICORN_PID $WORKER_PID 2>/dev/null || true
    wait $UVICORN_PID $WORKER_PID 2>/dev/null || true
    exit 0
}

# Trap signals for graceful shutdown
trap shutdown SIGTERM SIGINT

# Wait for either process to exit
wait -n

# If we get here, one process exited - shut down the other
echo "One service exited, shutting down remaining services..."
kill $UVICORN_PID $WORKER_PID 2>/dev/null || true
wait $UVICORN_PID $WORKER_PID 2>/dev/null || true

# Exit with error since a service died unexpectedly
exit 1
