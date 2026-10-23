"""
Manual recall + precision check for the coherence guard
(detector_type="COHERENCE"), in Hindi, using the dedicated coherence classifier
prompt + the live model.

The scenario report's auto-counselor won't reliably produce off-topic turns
(its goal-reminder framing keeps it on-topic), so we validate recall directly
here with controlled, labeled Hindi utterances.

Makes REAL gpt-4o-mini calls — named outside the test_* pattern so pytest does
NOT collect it. Run manually (needs PYTHONPATH=/app):
    docker exec ally-ai-learn-app \\
      python tests/unit/guardrail/manual_coherence_recall_check.py
"""

import asyncio

from app.core.config import settings
from app.core.constants import VisibilityType
from app.core.events.base import ChatMessage
from app.core.events.event_types.guardrail.guardrail_event import GuardrailEvent
from app.core.events.event_types.guardrail.schemas import GuardrailData

# Kept in sync with the sharpened seeded boundary (ally-be migration 254).
HELPER_DIALOGUE = (
    "Only trigger when the counselor's last utterance is unusable because of "
    "a speech-to-text failure: (a) phonetically garbled or non-words, "
    "(b) semantically incoherent with no recoverable intent, or (c) coherent "
    "words that are abruptly and completely unrelated to the ongoing "
    "conversation in a way that reads as a likely mistranscription. A "
    "coherent, grammatically valid, on-topic counseling statement is NOT a "
    "violation, even if it is emotional, reflective, supportive, validating, "
    "or a question. Do NOT trigger for: a legitimate topic change or tangent, "
    "a terse-but-valid reply, Hinglish or code-switching, emotional or "
    "backchannel utterances, disfluency or self-correction, or an utterance "
    "that is mostly clear with one odd word. When unsure, do NOT trigger."
)

ACTOR_DIALOGUE = "ask the counselor to repeat or rephrase"

# Hindi job-stress / social-anxiety counseling context.
# client: "I'm very afraid to speak up in front of people."
# counselor: "That fear is understandable. When do you feel most anxious?"
CONTEXT = [
    ChatMessage(
        role="client",
        content="मैं लोगों के सामने अपनी बात रखने से बहुत डरती हूँ।",
    ),
    ChatMessage(
        role="counselor",
        content="यह डर समझ में आता है। आप कब सबसे घबराहट महसूस करती हैं?",
    ),
]

# (utterance, expected_fire, description). English glosses in comments.
CASES = [
    # --- Coherent, on-topic counseling -> should NOT fire (precision) ---
    # "It's important to understand your feelings. Ready to take a small step?"
    (
        "आपकी भावनाओं को समझना ज़रूरी है। क्या आप एक छोटा कदम उठाने को तैयार हैं?",
        False,
        "Coherent on-topic counseling (question)",
    ),
    # "Your childhood experiences deeply affected your confidence."
    # (this is the exact line that misfired in report B)
    (
        "आपके बचपन के अनुभवों ने आपके आत्मविश्वास पर गहरा असर डाला है।",
        False,
        "Coherent reflective counseling (the report-B false positive)",
    ),
    # Hinglish / code-switching
    (
        "Haan, thoda nervous feel hota hai but main try kar rahi hoon.",
        False,
        "Hinglish / code-switching",
    ),
    # "Exactly right." (terse but valid)
    (
        "बिल्कुल सही।",
        False,
        "Terse but valid reply",
    ),
    # --- Genuinely unintelligible / off-topic -> SHOULD fire (recall) ---
    # "The train to Mumbai departs at midnight from platform nine." (unrelated)
    (
        "मुंबई जाने वाली ट्रेन रात बारह बजे प्लेटफॉर्म नंबर नौ से रवाना होगी।",
        True,
        "Abruptly unrelated (train timetable)",
    ),
    # "In today's cricket match the team scored 200 and won the toss."
    (
        "आज के क्रिकेट मैच में टीम ने दो सौ रन बनाए और टॉस जीता।",
        True,
        "Abruptly unrelated (cricket score)",
    ),
    # garbled non-words
    (
        "गल बल फट तर सम जक खड़ बर तस।",
        True,
        "Garbled non-words / gibberish",
    ),
    # word-salad, no recoverable intent
    (
        "the the and so under fly carrot nine meeting",
        True,
        "Word-salad, no recoverable intent",
    ),
]


async def main():
    if settings.OLLAMA_BASE_URL and settings.LOCAL_LLM_MODEL:
        print(f"Using Ollama: {settings.OLLAMA_BASE_URL} | {settings.LOCAL_LLM_MODEL}")
        llm_base_url = settings.OLLAMA_BASE_URL
        model = settings.LOCAL_LLM_MODEL
    else:
        print("Using OpenAI | model=gpt-4o-mini")
        llm_base_url = None
        model = "gpt-4o-mini"

    event = GuardrailEvent.create(
        event_id="guardrail-coherence",
        data=GuardrailData(
            helper_dialogue=HELPER_DIALOGUE, actor_dialogue=ACTOR_DIALOGUE
        ),
        model=model,
        llm_base_url=llm_base_url,
        detector_type="COHERENCE",
        score=0,
        visibility_type=VisibilityType.PASSIVE,
        emoji=None,
        emoji_message=None,
    )

    print("\n" + "=" * 72)
    print("COHERENCE GUARD — RECALL + PRECISION CHECK (Hindi, COHERENCE)")
    print("=" * 72)

    passed = failed = 0
    for utterance, expected, desc in CASES:
        conversations = CONTEXT + [ChatMessage(role="counselor", content=utterance)]
        result = await event.detect_event(conversations)
        ok = result == expected
        passed += ok
        failed += not ok
        print(f"\n{'PASS' if ok else 'FAIL'} | {desc}")
        print(f"  Utterance: {utterance}")
        print(f"  Expected fire={expected} | Got fire={result}")

    print("\n" + "=" * 72)
    print(f"Results: {passed} passed, {failed} failed (out of {len(CASES)})")
    print("=" * 72)


if __name__ == "__main__":
    asyncio.run(main())
