"""STT coherence guard: escalation policy and the platform-default guardrail.

THE PROBLEM
-----------
The STT coherence guard fires when the learner's transcribed utterance does not
cohere with the conversation — the signature of a mis-transcription. Its
configured response is a branching instruction telling the persona to ask the
learner to repeat. STT confidence is not usable for Indian languages (see
CLAUDE.md), so this guard is the ONLY mitigation for mis-transcription.

But it was built with ``DetectionConfig()`` defaults — ``max_occurrences=None``,
``min_gap_time=None`` — and GUARDRAIL is in the orchestrator's always-resend
set. Nothing counted consecutive misunderstandings. So a learner whose accent
the STT keeps mismatching could be asked to repeat, in the same words, for the
rest of the session: the exact loop with no escape.

THE POLICY
----------
1. **A coherent turn resets the streak.** Only *consecutive* misunderstandings
   count, so an isolated mishearing every few minutes never escalates.
2. **A minimum gap between requests** (``min_gap_s``) so one garbled stretch
   that produces two STT finalizations cannot produce two identical repeat
   requests back to back.
3. **Escalate after N consecutive** (``escalate_after``): instead of the
   author's repeat-request, the persona is instructed to ACKNOWLEDGE the
   difficulty and offer a way forward. Guidance that shaped this: an agent
   asking for clarification should avoid robotic or repetitive phrasing,
   reference what has already been said rather than starting from scratch, and
   be transparent about why it is asking ("Sequencing clarification questions
   to avoid user overwhelm"); and a failure should always come with a
   resolution path rather than a bare apology ("Apologetic Language and
   Resolution Paths in Agent Failures").
4. **Cooldown after escalating** (``escalation_cooldown_s``): the guard goes
   quiet, so the conversation can continue on best-effort transcripts instead
   of deadlocking on the guard.
5. **A hard cap** (``max_escalations``): after that the guard stops firing for
   the session. Asking a third time is nagging, and by then the guard has
   demonstrably not helped — the predictable neutral fallback (let the persona
   respond to what it heard) is better than an interrogation.

WHY THE TEXT BELOW IS ENGLISH
-----------------------------
These are **branching instructions**, i.e. instructions to the model, not
spoken copy. The system prompt (app/prompts/system/branching_agent_prompt.txt)
carries its own ``Output language:`` directive, so the model reads an English
instruction and speaks the session's language. This is the same contract every
scenario-authored ``actorDialogue`` uses. Contrast
app/core/fallback_lines.py, which holds text that IS spoken verbatim and
therefore has to be translated.
"""

from __future__ import annotations

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


def escalate_after() -> int:
    """Consecutive misunderstandings before escalating.

    3, not 2: one mishearing plus one bad repeat is an ordinary occurrence in a
    noisy room and should get a plain "say that again" both times. By the third
    consecutive failure the plain request has demonstrably not worked, and a
    fourth would be the loop this guard exists to prevent.
    """
    return max(1, int(getattr(settings, "STT_COHERENCE_ESCALATE_AFTER", 3)))


def min_gap_s() -> float:
    """Minimum seconds between two ordinary repeat requests."""
    return max(0.0, float(getattr(settings, "STT_COHERENCE_MIN_GAP_S", 8.0)))


def escalation_cooldown_s() -> float:
    """Seconds the guard stays silent after escalating."""
    return max(
        0.0, float(getattr(settings, "STT_COHERENCE_ESCALATION_COOLDOWN_S", 90.0))
    )


def max_escalations() -> int:
    """Escalations allowed per session before the guard gives up entirely."""
    return max(0, int(getattr(settings, "STT_COHERENCE_MAX_ESCALATIONS", 2)))


#: Instruction used on an ordinary fire when the scenario author supplied none
#: (i.e. only for the platform-default guardrail). Scenario-authored
#: actorDialogue is always preferred and is never overwritten.
DEFAULT_COHERENCE_ACTOR_DIALOGUE = (
    "You could not make out what the other person just said — it came through "
    "garbled. Stay fully in character and say, in your own words, that you did "
    "not catch that and ask them to repeat it. Keep it to one short sentence. "
    "Do NOT mention audio, microphones, transcription, connections or "
    "technology of any kind. If you have already asked them to repeat "
    "themselves recently, phrase it differently this time rather than "
    "repeating yourself."
)

#: Instruction substituted once the consecutive-misunderstanding threshold is
#: reached. Acknowledges the difficulty and offers a way forward instead of
#: asking for the same repeat again.
COHERENCE_ESCALATION_ACTOR_DIALOGUE = (
    "You have now failed several times in a row to make out what the other "
    "person is saying. Stay fully in character. Acknowledge openly that you "
    "are having trouble following them — do not pretend otherwise and do not "
    "simply ask them to repeat again. Then offer a way forward: suggest they "
    "speak a little more slowly, or say things in shorter pieces, or move on "
    "to whatever they feel is most important right now. Warm and unhurried, "
    "two short sentences at most, and make it clear you still want to hear "
    "them. Do NOT mention audio, microphones, transcription, connections or "
    "technology of any kind."
)

#: The boundary description handed to the COHERENCE classifier for the
#: platform-default guardrail. The classifier is precision-biased and must not
#: fire on coherent, on-topic content.
DEFAULT_COHERENCE_HELPER_DIALOGUE = (
    "The counsellor's utterance is incoherent or unintelligible in a way that "
    "indicates a speech-to-text mis-transcription rather than a deliberate "
    "choice: it is word salad, is in an unrelated language, or has no "
    "discernible relationship to anything in the conversation. A legitimate "
    "topic change, a short reply, a hesitant or clumsy sentence, silence "
    "filler, or an unusual but intelligible question is NOT a violation."
)


def default_guard_enabled() -> bool:
    """Whether to synthesize a coherence guardrail for scenarios lacking one.

    DEFAULT OFF, deliberately, and this is the one judgement call here worth a
    second opinion. Turning it on closes a real gap — a scenario with no
    COHERENCE guardrail has NO mitigation for mis-transcription at all. But a
    guardrail is a reply-shaping event, so it runs in ``process_gating_events``,
    which is a hard barrier before ``generate_response``: the default guard adds
    an LLM classification to the reply-gating path of every session.

    For a scenario that already runs gating classifiers the marginal cost is
    ~zero (detection is parallel, so one more call only matters if it becomes
    the slowest). For a scenario with no events at all it adds a full
    classification round-trip to every turn — and this repo's standing rule is
    that anything added between the learner finishing a sentence and hearing a
    reply is a product regression even when it is correct.

    So the mechanism ships complete and one env var from live
    (``STT_COHERENCE_GUARD_DEFAULT_ENABLED=true``) rather than flipping a
    platform-wide latency and cost change unilaterally.
    """
    return bool(getattr(settings, "STT_COHERENCE_GUARD_DEFAULT_ENABLED", False))


def build_default_coherence_guardrail(*, model: str, llm_base_url):
    """Build the platform-default COHERENCE guardrail event.

    Returns the event, or None on any failure — a scenario must never fail to
    load because of a guardrail we added on its behalf.
    """
    try:
        from app.core.branching_instructions.base import BranchingInstruction
        from app.core.constants import VisibilityType
        from app.core.events.base import DetectionConfig
        from app.core.events.event_types.guardrail.guardrail_event import GuardrailEvent
        from app.core.events.event_types.guardrail.schemas import GuardrailData

        return GuardrailEvent.create(
            event_id="guardrail-default-coherence",
            data=GuardrailData(
                helper_dialogue=DEFAULT_COHERENCE_HELPER_DIALOGUE,
                actor_dialogue=DEFAULT_COHERENCE_ACTOR_DIALOGUE,
            ),
            model=model,
            llm_base_url=llm_base_url,
            detector_type="COHERENCE",
            branching_instruction=BranchingInstruction.create(
                DEFAULT_COHERENCE_ACTOR_DIALOGUE, prompt_data=None
            ),
            score=0,
            visibility_type=VisibilityType.PASSIVE,
            emoji=None,
            emoji_message=None,
            detection_config=DetectionConfig(min_gap_time=min_gap_s()),
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            "[COHERENCE] failed to build the platform-default guardrail; "
            "scenario continues without it"
        )
        return None
