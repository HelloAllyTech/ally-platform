#!/bin/bash
set -e

echo "Starting application services (dev mode with hot reload)..."

# Sync prompts to ally-be (non-fatal if unreachable)
echo "Syncing prompts to ally-be..."
poetry run python scripts/sync_prompts.py || echo "Prompt sync failed (continuing with local prompts)."

# Start uvicorn with --reload for hot reload
poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
UVICORN_PID=$!

# Start v1 voice worker (LiveKit agent AGENT_NAME) in background
poetry run python -m app.worker start &
WORKER_PID=$!

# Start Roleplay Studio v2 voice worker (LiveKit agent AGENT_NAME_V2) in
# background. Gated on ROLEPLAY_V2_ENABLED (defaults on when unset).
start_worker_v2() {
    poetry run python -m app.worker_v2 start &
    WORKER_V2_PID=$!
}
WORKER_V2_PID=""
if [ "${ROLEPLAY_V2_ENABLED:-true}" != "false" ]; then
    start_worker_v2
fi

echo "Started uvicorn (PID: $UVICORN_PID), worker (PID: $WORKER_PID), worker_v2 (PID: ${WORKER_V2_PID:-disabled})"

shutdown() {
    echo "Shutting down services..."
    kill $UVICORN_PID $WORKER_PID $WORKER_V2_PID 2>/dev/null || true
    wait $UVICORN_PID $WORKER_PID $WORKER_V2_PID 2>/dev/null || true
    exit 0
}

trap shutdown SIGTERM SIGINT

# Supervisor loop: worker_v2 crashes are non-fatal (auto-restarted); only
# uvicorn / v1 worker exiting is fatal.
while true; do
    wait -n || true
    if ! kill -0 "$UVICORN_PID" 2>/dev/null; then
        echo "uvicorn exited; shutting down."
        break
    fi
    if ! kill -0 "$WORKER_PID" 2>/dev/null; then
        echo "v1 worker exited; shutting down."
        break
    fi
    if [ "${ROLEPLAY_V2_ENABLED:-true}" != "false" ] \
        && ! kill -0 "$WORKER_V2_PID" 2>/dev/null; then
        echo "worker_v2 exited; restarting in 5s (v1 unaffected)..."
        sleep 5
        start_worker_v2
    fi
done

echo "One service exited, shutting down remaining services..."
kill $UVICORN_PID $WORKER_PID $WORKER_V2_PID 2>/dev/null || true
wait $UVICORN_PID $WORKER_PID $WORKER_V2_PID 2>/dev/null || true
exit 1
