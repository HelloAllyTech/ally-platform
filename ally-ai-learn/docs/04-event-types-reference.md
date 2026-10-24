# Event Types Reference

**Purpose.** This document provides a reference card for each of the 9 event detection types, including detection mechanism, data schema, trigger behavior, and metadata examples.

---

## Detection Types Summary

| Type | Detection Mechanism | trigger_multiple | Typical Use |
|------|-------------------|-----------------|-------------|
| SENTENCE_SIMILARITY | Token-level match against sentence list | Yes | Detect specific phrases or keywords |
| SEMANTIC_SIMILARITY | Embedding cosine similarity | Yes | Detect semantic meaning regardless of wording |
| BINARY_CLASSIFIER | LLM-based yes/no classification | Yes | Detect abstract counseling behaviors |
| TIME | Timer-based trigger | No | Trigger at specific elapsed times |
| SCORE | Score threshold condition | No | Trigger when cumulative score crosses threshold |
| COMBINATION | Boolean logic over other events | No | Combine multiple event conditions |
| HELPER_UTTERANCE_LENGTH | Word count check | Yes | Detect overly long or short counselor utterances |
| HELPER_INTERRUPTED | Interruption detection | Yes | Detect when counselor interrupts the client |
| HELPER_PARAPHRASED | Paraphrase detection via embeddings | Yes | Detect when counselor paraphrases client speech |

---

## SENTENCE_SIMILARITY

**Class:** `SimilarityEvent` (`app/core/events/event_types/similarity_based/similarity_event.py`)

**Detection:** Tokenizes the last counselor utterance and compares against a list of target sentences using token-level matching. A match is found when the ratio of matching tokens exceeds `match_threshold` (default: 0.6) and the match has at least `min_match_tokens` (default: 2) tokens.

**Data Schema:**
```json
{
  "sentences": ["I understand how you feel", "That must be difficult"]
}
```

**Metadata Example:**
```json
{
  "id": "empathy_statement",
  "detectionType": "SENTENCE_SIMILARITY",
  "visibilityType": "ACTIVE",
  "data": {
    "sentences": ["I understand", "I hear you", "That sounds tough"]
  },
  "score": 5,
  "emoji": "star",
  "message": "Great use of empathy!",
  "feedbackStatus": true
}
```

---

## SEMANTIC_SIMILARITY

**Class:** `SemanticSimilarityEvent` (`app/core/events/event_types/semantic_similarity/semantic_similarity_event.py`)

**Detection:** Generates embeddings for the last counselor utterance and each target sentence using `OpenAIEmbeddingClient`. Computes cosine similarity and triggers if any pair exceeds the threshold (configurable per event, default from `SEMANTIC_SIMILARITY_THRESHOLD` setting).

**Data Schema:**
```json
{
  "sentences": ["expressing understanding of the client's feelings"],
  "threshold": 0.7
}
```

**Metadata Example:**
```json
{
  "id": "reflective_listening",
  "detectionType": "SEMANTIC_SIMILARITY",
  "visibilityType": "ACTIVE",
  "data": {
    "sentences": ["reflecting back what the client said"],
    "threshold": 0.65
  },
  "score": 3,
  "emoji": "thumbs_up",
  "message": "Good reflective listening!"
}
```

---

## BINARY_CLASSIFIER

**Class:** `BinaryClassifierEvent` (`app/core/events/event_types/binary_classifier/binary_classifier_event.py`)

**Detection:** Sends the conversation to an LLM with a classification prompt. The LLM determines if the counselor's behavior matches a described class (e.g., "showing empathy"). Supports positive and negative examples for few-shot classification.

**Data Schema:**
```json
{
  "className": "Showing Empathy",
  "positiveExamples": [{"text": "I can see this is hard for you"}],
  "negativeExamples": [{"text": "You should just move on"}]
}
```

**Metadata Example:**
```json
{
  "id": "open_ended_question",
  "detectionType": "BINARY_CLASSIFIER",
  "visibilityType": "ACTIVE",
  "data": {
    "className": "Asking an open-ended question",
    "positiveExamples": [
      {"text": "How does that make you feel?"},
      {"text": "Can you tell me more about that?"}
    ],
    "negativeExamples": [
      {"text": "Did you eat today?"},
      {"text": "Are you feeling better?"}
    ]
  },
  "score": 4,
  "message": "Great open-ended question!"
}
```

---

## TIME

**Class:** `TimeEvent` (`app/core/events/event_types/time/time_event.py`)

**Detection:** Triggers at a specified time offset (in seconds) after the session starts. Managed by `TimeEventScheduler` which creates `asyncio` timers. The `detect_event()` method is a no-op -- timing is handled by the scheduler.

**Data Schema:**
```json
{
  "condition": "GT",
  "time": 120
}
```

`condition` is a `ConditionOperator`: `GT`, `LT`, `GTE`, `LTE`, `EQ`.

**Metadata Example:**
```json
{
  "id": "two_minute_check",
  "detectionType": "TIME",
  "visibilityType": "PASSIVE",
  "data": {
    "condition": "GTE",
    "time": 120
  },
  "score": 0,
  "branchInstruction": "The session has been going for 2 minutes. Start wrapping up."
}
```

---

## SCORE

**Class:** `ScoreEvent` (`app/core/events/event_types/score/score_event.py`)

**Detection:** Triggers when the cumulative session score meets a condition. Evaluated by `ScoreEvaluatorMixin` during orchestration, not via `detect_event()`.

**Data Schema:**
```json
{
  "condition": "GTE",
  "score": 10
}
```

**Metadata Example:**
```json
{
  "id": "high_performer",
  "detectionType": "SCORE",
  "visibilityType": "ACTIVE",
  "data": {
    "condition": "GTE",
    "score": 15
  },
  "score": 2,
  "emoji": "trophy",
  "message": "Excellent counseling skills!"
}
```

---

## COMBINATION

**Class:** `CombinationEvent` (`app/core/events/event_types/combination/combination_event.py`)

**Detection:** Evaluates a boolean expression tree over other events' `happened` states in the registry. Supports `AND`, `OR`, and `NOT` operators. Combination events that reference other combination events are automatically expanded to only reference simple events.

**Data Schema:**
```json
{
  "dependent_events": ["event_a", "event_b"],
  "expression": {
    "type": "AND",
    "left": {"type": "IDENTIFIER", "id": "event_a"},
    "right": {"type": "NOT", "operand": {"type": "IDENTIFIER", "id": "event_b"}}
  }
}
```

**Metadata Example:**
```json
{
  "id": "empathy_without_interruption",
  "detectionType": "COMBINATION",
  "visibilityType": "ACTIVE",
  "data": {
    "dependent_events": ["empathy_statement", "interruption"],
    "expression": {
      "type": "AND",
      "left": {"type": "IDENTIFIER", "id": "empathy_statement"},
      "right": {
        "type": "NOT",
        "operand": {"type": "IDENTIFIER", "id": "interruption"}
      }
    }
  },
  "score": 5,
  "message": "Great empathy without interrupting!"
}
```

---

## HELPER_UTTERANCE_LENGTH

**Class:** `UtteranceLengthEvent` (`app/core/events/event_types/utterance_length/utterance_length_event.py`)

**Detection:** Checks the word count of the last counselor utterance against a condition and threshold.

**Data Schema:**
```json
{
  "condition": "GT",
  "wordCount": 50
}
```

**Metadata Example:**
```json
{
  "id": "long_utterance",
  "detectionType": "HELPER_UTTERANCE_LENGTH",
  "visibilityType": "ACTIVE",
  "data": {
    "condition": "GT",
    "wordCount": 80
  },
  "score": -2,
  "message": "Try to keep responses more concise"
}
```

---

## HELPER_INTERRUPTED

**Class:** `InterruptionEvent` (`app/core/events/event_types/interruption/interruption_event.py`)

**Detection:** Detects when the counselor interrupts the client mid-speech. Uses message timing information (`start_time`, `end_time`) to determine if an overlap occurred.

**Data Schema:**
```json
{}
```

No additional data is required. The event detects interruptions from the conversation timeline.

**Metadata Example:**
```json
{
  "id": "counselor_interrupted",
  "detectionType": "HELPER_INTERRUPTED",
  "visibilityType": "ACTIVE",
  "data": {},
  "score": -3,
  "emoji": "warning",
  "message": "Try not to interrupt the client"
}
```

---

## HELPER_PARAPHRASED

**Class:** `HelperParaphrasedEvent` (`app/core/events/event_types/helper_paraphrased/helper_paraphrased_event.py`)

**Detection:** Detects when the counselor paraphrases the client's previous utterance. Uses embeddings to compare the counselor's last message with the client's preceding message.

**Data Schema:**
```json
{}
```

No additional data is required. The event uses the embedding client to measure semantic similarity between consecutive messages.

**Metadata Example:**
```json
{
  "id": "paraphrasing_skill",
  "detectionType": "HELPER_PARAPHRASED",
  "visibilityType": "ACTIVE",
  "data": {},
  "score": 4,
  "emoji": "sparkles",
  "message": "Nice paraphrasing!"
}
```

---

## COHERENCE

**Class:** `GuardrailEvent` (`app/core/events/event_types/guardrail/guardrail_event.py`), `detector_type: "COHERENCE"`

**Detection:** Not a new event class — a `detector_type` on the existing `GuardrailEvent`, which otherwise resends its `actorDialogue` as a branching instruction on every classified violation. COHERENCE adds an escalation policy on top of that classifier so a learner the STT keeps mismeaning is not asked to repeat the same line forever: see [`app/core/events/coherence_guard.py`](../app/core/events/coherence_guard.py) for the escalate-after-N / cooldown / hard-cap policy and the actor/helper dialogue it swaps in. Off by default behind `STT_COHERENCE_GUARD_DEFAULT_ENABLED`.

Once the hard cap is spent the guard is silent for the rest of the session whatever the classifier says, so from then on `detect_event` skips the classification entirely rather than paying for (and gating the reply on) a call whose answer would be discarded. Every earlier turn -- cooldowns included, because a coherent turn there still resets the streak -- is classified exactly as before.

State (`coherence_consecutive_misses`, `coherence_escalations`, `coherence_quiet_until`, `coherence_normal_instruction`, `coherence_escalation_instruction`) lives on the event instance as ordinary fields, not pydantic private attrs, because these events are built with `model_construct` — never serialized onto the wire, since `serialize_event` builds an explicit dict.

`GuardrailEvent` itself (its config-time `branching_instruction`, its default `detector_type: "CATEGORY"`, and how it differs from the score/feedback detection types documented above) is not otherwise covered by this reference — see [`docs/events-off-gate-design.md`](events-off-gate-design.md) and [`app/core/events/event_types/guardrail/guardrail_event.py`](../app/core/events/event_types/guardrail/guardrail_event.py) directly. COHERENCE only changes whether a classified violation actually fires (and, once the cap is spent, whether to classify at all), not how the classification itself works.

Its `prompt_data` field carries the session's prompt data, so the four classifier prompts (`events/guardrail_system`/`_user`, `events/coherence_guardrail_system`/`_user`) render from the Skills Store text in room metadata rather than the local defaults; see [`docs/12-prompts-system.md`](12-prompts-system.md).

---

## AI usage (cost) per detection type

Every detection type that calls a model records the call to `llm_usage` (see
[Queue Messaging](11-queue-messaging.md)), attributed to the session by the graph run's room:
BINARY_CLASSIFIER (single and batched) as `binary_classifier`, guardrails including COHERENCE as
`guardrail_check` (provider `ollama` when routed to a local model), HELPER_PARAPHRASED as
`helper_paraphrased`, and SEMANTIC_SIMILARITY's embeddings as `event_embedding` (target sentences
once per pattern set, then one input embedding per utterance; cache hits make no call and record
nothing). A new model-calling detection type needs its own label here and in ally-be's `LlmTask`.

## Key Source Files

- `app/core/events/event_types/similarity_based/` -- SENTENCE_SIMILARITY
- `app/core/events/event_types/semantic_similarity/` -- SEMANTIC_SIMILARITY
- `app/core/events/event_types/binary_classifier/` -- BINARY_CLASSIFIER
- `app/core/events/event_types/time/` -- TIME
- `app/core/events/event_types/score/` -- SCORE
- `app/core/events/event_types/combination/` -- COMBINATION
- `app/core/events/event_types/utterance_length/` -- HELPER_UTTERANCE_LENGTH
- `app/core/events/event_types/interruption/` -- HELPER_INTERRUPTED
- `app/core/events/event_types/helper_paraphrased/` -- HELPER_PARAPHRASED
- `app/core/events/factory.py` -- `_create_event_by_detection_type()`
- `app/core/constants.py` -- `DetectionType` enum
