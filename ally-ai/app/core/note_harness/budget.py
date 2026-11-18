"""The per-session budget: a fixed part plus a bonus for length (DESIGN §6.2)."""

from app.core.note_harness.models import Budget, BudgetSettings

# A summary never needs more than about half the words that were spoken: a
# short dictation shouldn't be padded out to reach the base.
_MAX_SHARE_OF_TRANSCRIPT = 0.5
_REPAIR_THRESHOLD = 0.6
_MAX_OUTPUT_TOKENS = 16000


def compute_budget(
    transcript_minutes: float,
    transcript_words: int,
    settings: BudgetSettings,
    field_count: int,
) -> Budget:
    minutes = max(0.0, transcript_minutes)
    base = max(1, settings.base_words)
    cap = max(base, settings.cap_words)
    narrative_words = int(
        min(cap, max(base, base + settings.per_minute_words * minutes))
    )

    supportable = int(transcript_words * _MAX_SHARE_OF_TRANSCRIPT)
    min_words = int(_REPAIR_THRESHOLD * min(narrative_words, supportable))

    # ~1.4 tokens a word for the narrative, the JSON around it, and room for
    # each field's value and evidence ids.
    max_tokens = int(narrative_words * 2 + field_count * 150 + 600)

    return Budget(
        transcript_minutes=round(minutes, 2),
        transcript_words=transcript_words,
        narrative_words=narrative_words,
        min_narrative_words=max(0, min_words),
        max_output_tokens=min(_MAX_OUTPUT_TOKENS, max_tokens),
        time_budget_s=int(60 + 4 * minutes),
    )
