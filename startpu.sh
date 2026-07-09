#!/bin/bash
set -e

echo "Starting application services..."

# Sync prompts to ally-be (runs at deployment; non-fatal if ally-be unreachable)
echo "Syncing prompts to ally-be..."
python scripts/sync_prompts.py || echo "Prompt sync failed (continuing with local prompts)."

# Start uvicorn in background
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
UVICORN_PID=$!

# Start v1 voice worker (LiveKit agent AGENT_NAME) in background
python -m app.worker start &
WORKER_PID=$!

# Start Roleplay Studio v2 voice worker (LiveKit agent AGENT_NAME_V2) in
# background. Gated on ROLEPLAY_V2_ENABLED (defaults on when unset) so the
# kill-switch stops the process itself, not just per-job dispatch.
start_worker_v2() {
    python -m app.worker_v2 start &
    WORKER_V2_PID=$!
}
WORKER_V2_PID=""
if [ "${ROLEPLAY_V2_ENABLED:-true}" != "false" ]; then
    start_worker_v2
fi

echo "Started uvicorn (PID: $UVICORN_PID), worker (PID: $WORKER_PID), worker_v2 (PID: ${WORKER_V2_PID:-disabled})"

# Graceful shutdown. worker_v2 is a direct child so it receives SIGTERM and can
# drain live sessions.
shutdown() {
    echo "Shutting down services..."
    kill $UVICORN_PID $WORKER_PID $WORKER_V2_PID 2>/dev/null || true
    wait $UVICORN_PID $WORKER_PID $WORKER_V2_PID 2>/dev/null || true
    exit 0
}

trap shutdown SIGTERM SIGINT

# Supervisor loop: a worker_v2 crash is NON-fatal — auto-restarted, never takes
# down the v1 worker or uvicorn. Only uvicorn / v1 worker exiting is fatal.
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

echo "A critical service exited, shutting down remaining services..."
kill $UVICORN_PID $WORKER_PID $WORKER_V2_PID 2>/dev/null || true
wait $UVICORN_PID $WORKER_PID $WORKER_V2_PID 2>/dev/null || true

exit 1
