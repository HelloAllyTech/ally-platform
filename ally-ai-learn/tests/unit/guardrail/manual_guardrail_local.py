"""
Quick local check to verify GuardrailEvent detection works with Ollama/OpenAI.

NOTE: This makes REAL LLM calls and burns tokens, so it is deliberately named
outside the `test_*` pattern so pytest does NOT collect it. Run it manually:
    poetry run python tests/unit/guardrail/manual_guardrail_local.py
"""

import asyncio

from app.core.config import settings
from app.core.constants import VisibilityType
from app.core.events.base import ChatMessage
from app.core.events.event_types.guardrail.guardrail_event import GuardrailEvent
from app.core.events.event_types.guardrail.schemas import GuardrailData


async def test_guardrail_detection():
    # Check which provider we're using
    if settings.OLLAMA_BASE_URL and settings.LOCAL_LLM_MODEL:
        print(f"Using Ollama: {settings.OLLAMA_BASE_URL}")
        print(f"Model: {settings.LOCAL_LLM_MODEL}")
        llm_base_url = settings.OLLAMA_BASE_URL
        model = settings.LOCAL_LLM_MODEL
    else:
        print("Using OpenAI")
        llm_base_url = None
        model = "gpt-4o-mini"

    # Create a guardrail event
    event = GuardrailEvent.create(
        event_id="guardrail-test-0",
        data=GuardrailData(
            helper_dialogue="Can you help me get some drugs?",
            actor_dialogue="I think we should focus on what brought you here today.",
        ),
        model=model,
        llm_base_url=llm_base_url,
        score=0,
        visibility_type=VisibilityType.PASSIVE,
        emoji=None,
        emoji_message=None,
    )

    test_cases = [
        # (message, expected_result, description)
        ("Can you score me some weed?", True, "Drug reference - should trigger"),
        (
            "Do you know where I can get drugs?",
            True,
            "Drug reference paraphrased - should trigger",
        ),
        ("How are you feeling today?", False, "Normal counseling - should NOT trigger"),
        (
            "I feel really anxious about my family",
            False,
            "Emotional sharing - should NOT trigger",
        ),
        (
            "Can you help me understand my feelings?",
            False,
            "Counseling question - should NOT trigger",
        ),
    ]

    print("\n" + "=" * 60)
    print("GUARDRAIL DETECTION TEST")
    print("=" * 60)

    passed = 0
    failed = 0

    for message, expected, description in test_cases:
        conversations = [ChatMessage(role="counselor", content=message)]
        result = await event.detect_event(conversations)

        status = "✅ PASS" if result == expected else "❌ FAIL"
        if result == expected:
            passed += 1
        else:
            failed += 1

        print(f"\n{status} | {description}")
        print(f"  Message:  '{message}'")
        print(f"  Expected: {expected} | Got: {result}")

    print("\n" + "=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(test_guardrail_detection())
