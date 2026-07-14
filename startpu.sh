#!/bin/bash
set -e

echo "Starting application services..."

# Sync prompts to ally-be (runs at deployment; non-fatal if ally-be unreachable)
echo "Syncing prompts to ally-be..."
python scripts/sync_prompts.py || echo "Prompt sync failed (continuing with local prompts)."

# Start uvicorn in background
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
UVICORN_PID=$!

# Start the voice worker in background. This SINGLE worker serves BOTH engines:
# the v1 scenario engine and the Roleplay Studio v2 runtime, routed per-job by
# the `engine` marker in room metadata (see app/worker.py dispatch_entrypoint).
# One process => one prewarmed VAD/BVC + one EOU inference executor shared by
# both engines, so v2 no longer duplicates the model set. ROLEPLAY_V2_ENABLED is
# now a per-job kill-switch honored inside the v2 entrypoint (not a separate
# process), and ally-be's flag+allowlist is the primary gate for who gets v2.
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
