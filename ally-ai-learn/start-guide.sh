#!/bin/bash
# The Ally guide voice worker's container command (its own ECS service; same
# image as learn-core). Mirrors start.sh: uvicorn serves /api/health, which
# reads this worker's registration heartbeat, and whichever process exits
# first takes the container down so the orchestrator replaces it.
# No prompt sync: the guide worker uses no prompts. docs/guide-voice-worker.md
set -e

echo "Starting the Ally guide voice worker..."

poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
UVICORN_PID=$!

poetry run python -m app.guide_worker start &
WORKER_PID=$!

echo "Started uvicorn (PID: $UVICORN_PID), guide worker (PID: $WORKER_PID)"

shutdown() {
    echo "Shutting down services..."
    kill $UVICORN_PID $WORKER_PID 2>/dev/null || true
    wait $UVICORN_PID $WORKER_PID 2>/dev/null || true
    exit 0
}

trap shutdown SIGTERM SIGINT

wait -n || true

echo "A critical service exited, shutting down remaining services..."
kill $UVICORN_PID $WORKER_PID 2>/dev/null || true
wait $UVICORN_PID $WORKER_PID 2>/dev/null || true
exit 1
