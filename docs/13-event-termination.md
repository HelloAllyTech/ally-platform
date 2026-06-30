# Event Termination

**Purpose.** This document describes how events can automatically terminate a session, the configuration format, and the termination flow.

---

## Overview

When certain events are detected during a conversation, the session can automatically end. The agent speaks a termination message, then disconnects. This is configured via `autoTerminationEvent` (deprecated, single) or `autoTerminationEvents` (list) in the scenario metadata.

## Configuration

### autoTerminationEvents (recommended)

List of termination event configurations:

```json
{
  "scenario": {
    "autoTerminationEvents": [
      {
        "id": "session-end",
        "terminationMessage": "Thank you for today. Take care.",
        "score": 5
      },
      {
        "id": "goodbye-early",
        "terminationMessage": "I understand you need to go. Goodbye.",
        "score": 3
      }
    ],
    "events": [
      {
        "id": "session-end",
        "detectionType": "SENTENCE_SIMILARITY",
        "data": { "sentences": ["goodbye", "end session", "that's all for today"] },
        "score": 0,
        "emoji": "👋",
        "message": "Session ended"
      }
    ]
  }
}
```

### autoTerminationEvent (deprecated)

Single event format (use `autoTerminationEvents` for multiple):

```json
{
  "scenario": {
    "autoTerminationEvent": {
      "id": "session-end",
      "terminationMessage": "Thank you for today. Take care.",
      "score": 5
    }
  }
}
```

### Required Fields

| Field | Description |
|-------|-------------|
| `id` | Event ID that triggers termination (must match an event in the `events` array) |
| `terminationMessage` | Message the agent speaks before disconnecting |
| `score` | Optional. Priority when multiple termination events fire in the same turn (higher magnitude wins) |

## Supported Event Types

Termination can be triggered by any event type that can fire:

- **SENTENCE_SIMILARITY** — e.g., "goodbye", "end session"
- **SEMANTIC_SIMILARITY** — semantic match
- **BINARY_CLASSIFIER** — e.g., counselor says they need to end
- **TIME** — e.g., session reaches 15 minutes
- **SCORE** — e.g., cumulative score crosses threshold
- **COMBINATION** — e.g., empathy detected AND time elapsed
- **HELPER_UTTERANCE_LENGTH**, **HELPER_INTERRUPTED**, **HELPER_PARAPHRASED**

## Termination Flow

1. **Event detected** — EventOrchestrator detects an event whose `event_id` is in `termination_events`
2. **Defer to Core** — Event is sent to SQS with `autoTerminationStatus: true` (deferred so agent can speak first)
3. **Select termination** — If multiple termination events fire, the one with highest magnitude `score` is chosen
4. **Callback** — `_handle_termination_events()` invokes the termination callback
5. **Entrypoint** — Worker's entrypoint receives signal, plays the termination audio, then calls `ctx.shutdown()`
6. **Backend** — Core receives the deferred event and closes the room

The termination message is played in the **entrypoint context** (not the graph context) to ensure reliable audio playback.

## Key Source Files

- `app/core/scenario/base.py` — `TerminationEvent`, `_build_termination_events()`
- `app/core/events/event_orchestrator/event_orchestrator.py` — `termination_events`, `termination_event_ids`
- `app/core/events/event_orchestrator/event_sender.py` — `_handle_termination_events()`, `get_termination_config()`
- `app/worker.py` — `_handle_termination_in_entrypoint_context()`
