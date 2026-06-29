#!/bin/bash
set -e

echo "Starting application services..."

# Sync prompts to ally-be (runs at deployment; non-fatal if ally-be unreachable)
echo "Syncing prompts to ally-be..."
python scripts/sync_prompts.py || echo "Prompt sync failed (continuing with local prompts)."

# Start uvicorn in background
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
UVICORN_PID=$!

# Start client agent worker in background
python -m app.worker start &
WORKER_PID=$!

# Start simulated user worker in background (handles V2V test session dispatches)
python -m app.simulated_user_worker start &
SIM_USER_PID=$!

echo "Started uvicorn (PID: $UVICORN_PID), worker (PID: $WORKER_PID), simulated_user_worker (PID: $SIM_USER_PID)"

shutdown() {
    echo "Shutting down services..."
    kill $UVICORN_PID $WORKER_PID $SIM_USER_PID 2>/dev/null || true
    wait $UVICORN_PID $WORKER_PID $SIM_USER_PID 2>/dev/null || true
    exit 0
}

trap shutdown SIGTERM SIGINT

wait -n

echo "One service exited, shutting down remaining services..."
kill $UVICORN_PID $WORKER_PID $SIM_USER_PID 2>/dev/null || true
wait $UVICORN_PID $WORKER_PID $SIM_USER_PID 2>/dev/null || true

exit 1
