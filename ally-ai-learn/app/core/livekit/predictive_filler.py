"""LLM-generated thinking-fillers for a live role-play — in character, in context.

The static thinking-filler plays a fixed set of phrases authored in Studio. This
module produces *dynamic* fillers: short back-channels the character would
plausibly say next, tailored to where the dialogue is heading.

There are three generation moments, each answering a different problem:

* **Seed** (``generate_seed_fillers``) — once at session start, from the
  character alone. There is no conversation yet, so this can't be context-aware;
  its job is to make sure a filler EXISTS before the learner's first turn, which
  previously it did not (the old timer needed a completed exchange plus a cycle).
* **Exchange** (``generate_predictive_fillers``) — after the character finishes
  speaking, from the conversation so far. Runs while the pipeline is idle, so it
  never contends with the real reply's request.
* **In-turn** (``generate_in_turn_fillers``) — while the learner is STILL
  speaking, from the partial transcript. This is the only one that can produce a
  filler which fits what the learner just said: a batch generated on a timer
  necessarily predates the turn it ends up answering.

All three ask for TYPED, length-varied options, because playback needs both — the
type to avoid two of the same kind of noise in a row, the length to pick a clip
that ends about when the real reply starts.

The prompt is the superadmin-editable ``filler/predictive_filler`` template
(System Skills), resolved via the normal prompt pipeline — DB override when a
superadmin edits it, local ``.txt`` otherwise.

Everything here is best-effort: any failure returns an empty list so the worker
silently keeps using whatever it already has. It must never raise into a session.

All three moments' token usage is emitted to ``llm_usage`` as
``thinking_filler`` against the room the caller passes — they run from worker
tasks, outside the graph run whose context var ``get_room_id`` reads.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, List, Optional, Tuple

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.livekit.filler_clips import FILLER_TYPES
from app.core.logger import get_logger
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)

# How many recent turns to show the model. The filler only needs the immediate
# trajectory of the conversation, not the whole history — keeps the prompt small
# and the call fast.
_HISTORY_WINDOW = 10

#: Hard ceiling on filler length. A "filler" of more than this many words has
#: stopped being a back-channel and started being a reply, which is exactly what
#: it must never be (a real reply is coming and mustn't be contradicted).
_MAX_WORDS = 12


class _FillerOption(BaseModel):
    """One generated filler: the words, and what kind of noise it is."""

    text: str = Field(description="The filler phrase, as it would be spoken.")
    type: str = Field(
        default="hesitation",
        description=("One of: hesitation, acknowledgement, reflection, encouragement."),
    )


class _PredictiveFillers(BaseModel):
    """Structured LLM output: the list of typed filler options."""

    fillers: List[_FillerOption]


def _normalize_type(raw: Any) -> str:
    """Map the model's type tag onto a known type, defaulting to hesitation."""
    value = str(raw or "").strip().lower()
    for known in FILLER_TYPES:
        if known in value:
            return known
    return "hesitation"


def is_safe_filler(text: str, partial_text: Optional[str] = None) -> bool:
    """Whether ``text`` is safe to speak as a filler before the real reply.

    The prompt already forbids committing to anything, but a filler is spoken
    BEFORE the reply exists and can therefore contradict it, so the rules are
    enforced in code as well rather than trusted to the model. Rejects:

    * anything long enough to be a statement rather than a back-channel;
    * questions, which demand an answer the filler can't give;
    * digits, which are always a specific claim (a time, an amount, a dose);
    * any content word lifted from the learner's partial transcript — echoing a
      specific back at them reads as a response to it, and the partial may be
      cut off mid-meaning, so the echo can be flatly wrong.
    """
    phrase = (text or "").strip()
    if not phrase:
        return False
    words = phrase.split()
    if len(words) > _MAX_WORDS:
        return False
    if "?" in phrase or "？" in phrase:
        return False
    if any(ch.isdigit() for ch in phrase):
        return False
    if partial_text:
        # Content words = 4+ characters, which skips articles/particles across
        # the languages we run and leaves the words that carry specifics.
        partial_words = {
            w.strip(".,!?;:\"'").lower()
            for w in re.split(r"\s+", partial_text)
            if len(w.strip(".,!?;:\"'")) >= 4
        }
        for word in words:
            if word.strip(".,!?;:\"'").lower() in partial_words:
                return False
    return True


def _clean_options(
    raw: Any,
    limit: int,
    partial_text: Optional[str] = None,
    exclude: Optional[List[str]] = None,
) -> List[Tuple[str, str]]:
    """Validate model output into ``(phrase, type)`` pairs.

    Drops malformed entries, unsafe phrases (see ``is_safe_filler``), duplicates
    within the batch, and anything already in ``exclude`` (the session pool), so
    a regeneration adds genuinely new material instead of near-copies.
    """
    out: List[Tuple[str, str]] = []
    seen = {p.strip().lower() for p in (exclude or []) if isinstance(p, str)}
    for option in raw or []:
        text = getattr(option, "text", None)
        if text is None and isinstance(option, dict):
            text = option.get("text")
        if not isinstance(text, str):
            continue
        phrase = text.strip()
        key = phrase.lower()
        if not phrase or key in seen:
            continue
        if not is_safe_filler(phrase, partial_text):
            logger.info("[FILLER] rejected unsafe option %r", phrase)
            continue
        ftype = _normalize_type(
            getattr(option, "type", None)
            if not isinstance(option, dict)
            else option.get("type")
        )
        seen.add(key)
        out.append((phrase, ftype))
        if len(out) >= limit:
            break
    return out


def _build_scenario_context(scenario) -> str:
    """Compact description of the character the filler is spoken by.

    Pulls the few fields that orient the model to who is speaking and the
    situation, skipping anything empty. Best-effort — returns "" if nothing
    useful is available (the prompt still works, just with less grounding).
    """
    pd = getattr(scenario, "prompt_data", None)
    if pd is None:
        return ""
    parts: List[str] = []
    for label, attr in (
        ("Title", "title"),
        ("Character", "name"),
        ("Profession", "profession"),
        ("Description", "description"),
        ("Context", "context"),
        ("Role instructions", "role_instructions"),
    ):
        value = getattr(pd, attr, None)
        if value and str(value).strip():
            parts.append(f"{label}: {str(value).strip()}")
    return "\n".join(parts)


def build_character_voice(
    scenario, messages: Optional[List[BaseMessage]] = None
) -> str:
    """How this character actually SOUNDS, for the prompt's voice block.

    The descriptive fields in ``_build_scenario_context`` say who the character
    is; they say nothing about their register or idiom, which is why fillers
    generated from them alone come out generic and can clash with the scene (a
    brisk "Right, okay" in a grief scenario). The main agent prompt already has
    the two fields that carry voice — the authored linguistic style samples and
    the language's allowed discourse particles — so the filler prompt gets them
    too, plus the character's own last line as the immediate register to
    continue.
    """
    from app.core.graph.prompt import (
        _format_allowed_fillers_for_prompt,
        _format_language_samples,
    )

    pd = getattr(scenario, "prompt_data", None)
    if pd is None:
        return ""
    parts: List[str] = []

    samples = getattr(pd, "linguistic_style_samples", None) or getattr(
        pd, "language_samples", None
    )
    if samples:
        formatted = _format_language_samples(samples)
        if formatted:
            parts.append(
                "How this character speaks (authored examples — match this "
                f"register and idiom):\n{formatted}"
            )

    allowed = getattr(pd, "allowed_fillers", None)
    if allowed:
        parts.append(
            "Discourse particles this language/character actually uses: "
            f"{_format_allowed_fillers_for_prompt(allowed)}"
        )

    # The character's own most recent line is the strongest available signal of
    # their CURRENT mood — a distressed character hesitates differently from a
    # defensive one, and neither sounds like the neutral persona description.
    for msg in reversed(messages or []):
        if isinstance(msg, AIMessage):
            content = str(getattr(msg, "content", "") or "").strip()
            if content:
                parts.append(
                    "The character's last line (continue this emotional register): "
                    f'"{content[:400]}"'
                )
            break

    return "\n\n".join(parts)


def _format_recent_fillers(recent_fillers: Optional[List[str]]) -> str:
    """Render already-used fillers for the anti-repeat instruction."""
    cleaned = [p.strip() for p in (recent_fillers or []) if p and p.strip()]
    if not cleaned:
        return "(none yet)"
    return "; ".join(cleaned)


def _format_history(messages: List[BaseMessage], window: int = _HISTORY_WINDOW) -> str:
    """Render the last ``window`` turns as a readable script.

    HumanMessage = the learner (COUNSELLOR), AIMessage = the character the
    filler is for (CHARACTER). System messages are skipped.
    """
    lines: List[str] = []
    for msg in messages[-window:] if window > 0 else []:
        if isinstance(msg, HumanMessage):
            role = "COUNSELLOR"
        elif isinstance(msg, AIMessage):
            role = "CHARACTER"
        else:
            continue
        content = getattr(msg, "content", "")
        if content and str(content).strip():
            lines.append(f"{role}: {str(content).strip()}")
    return "\n".join(lines)


async def _generate(
    llm_client,
    scenario,
    user_content: str,
    count: int,
    messages: Optional[List[BaseMessage]] = None,
    recent_fillers: Optional[List[str]] = None,
    partial_text: Optional[str] = None,
    timeout_s: Optional[float] = None,
    room_id: Optional[str] = None,
) -> List[Tuple[str, str]]:
    """Shared path for all three generation moments.

    Builds the prompt (persona + voice + anti-repeat), calls the model with
    structured output, and returns cleaned ``(phrase, type)`` pairs. Returns []
    on any failure — the caller keeps whatever it already had.
    """
    if llm_client is None or count <= 0:
        return []
    try:
        language_code = (
            getattr(getattr(scenario, "language_config", None), "language_code", None)
            or "en-US"
        )
        pd = getattr(scenario, "prompt_data", None)
        language_label = getattr(pd, "language_label", None) or language_code

        system_prompt = load_and_format(
            "filler/predictive_filler",
            prompt_data=pd,
            scenario_context=_build_scenario_context(scenario),
            character_voice=build_character_voice(scenario, messages),
            language_label=language_label,
            language_code=language_code,
            count=count,
            filler_types=", ".join(FILLER_TYPES),
            recent_fillers=_format_recent_fillers(recent_fillers),
        )
        if not system_prompt or not system_prompt.strip():
            logger.warning("[FILLER] predictive: prompt template empty; skipping")
            return []

        llm_instance = llm_client.llm_instance
        # include_raw because the parsed model alone carries no usage metadata.
        call = llm_instance.with_structured_output(
            _PredictiveFillers, include_raw=True
        ).ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_content),
            ]
        )
        result = (
            await asyncio.wait_for(call, timeout=timeout_s) if timeout_s else await call
        )
        if isinstance(result, dict):
            # Emitted before parsing: a parse failure still spent the tokens.
            from app.core.llm_usage.emitter import emit_langchain_usage
            from app.core.llm_usage.tasks import LLMTask

            emit_langchain_usage(
                result.get("raw"),
                task=LLMTask.THINKING_FILLER.value,
                llm_client=llm_client,
                room_id=room_id,
                scenario_id=getattr(scenario, "id", None),
            )
            response = result.get("parsed")
        else:
            # Defensive: some providers/wrappers may ignore include_raw.
            response = result
        return _clean_options(
            getattr(response, "fillers", None),
            count,
            partial_text=partial_text,
            exclude=recent_fillers,
        )
    except asyncio.TimeoutError:
        logger.info("[FILLER] generation timed out; keeping existing fillers")
        return []
    except Exception as e:  # noqa: BLE001 - a filler must never break a session
        logger.warning("[FILLER] generation failed: %s", e)
        return []


async def generate_seed_fillers(
    llm_client,
    scenario,
    count: int = 8,
    room_id: Optional[str] = None,
) -> List[Tuple[str, str]]:
    """Fillers from the character alone, for use before the first learner turn.

    No conversation exists yet, so these are the persona's baseline hesitations
    rather than context-aware ones. Their job is availability: without them the
    first turns of a session have nothing to play unless Studio happened to
    author static filler words.
    """
    return await _generate(
        llm_client,
        scenario,
        user_content=(
            f"The role-play is about to begin. Generate {count} filler options "
            "this character would use while gathering their thoughts, before you "
            "know what will be said."
        ),
        count=count,
        room_id=room_id,
    )


async def generate_predictive_fillers(
    llm_client,
    scenario,
    messages: List[BaseMessage],
    count: int = 8,
    recent_fillers: Optional[List[str]] = None,
    room_id: Optional[str] = None,
) -> List[Tuple[str, str]]:
    """Fillers for where the conversation is heading, from the turns so far.

    Called when the character has just finished speaking and the pipeline is
    idle, so the call can't contend with the real reply's request — the
    contention that previously added ~270 ms to reply time-to-first-token.
    """
    conversation_text = _format_history(messages)
    if not conversation_text:
        return []
    return await _generate(
        llm_client,
        scenario,
        user_content=(
            f"Conversation so far:\n\n{conversation_text}\n\n"
            f"Generate {count} predictive filler options now."
        ),
        count=count,
        messages=messages,
        recent_fillers=recent_fillers,
        room_id=room_id,
    )


async def generate_in_turn_fillers(
    llm_client,
    scenario,
    messages: List[BaseMessage],
    partial_text: str,
    count: int = 3,
    timeout_s: Optional[float] = None,
    room_id: Optional[str] = None,
) -> List[Tuple[str, str]]:
    """Fillers that fit what the learner is saying RIGHT NOW.

    Fired mid-utterance from the partial transcript, so by the time the learner
    stops the clip is synthesized and waiting. This is the only path whose output
    has seen the current turn; everything else necessarily predates it.

    The partial is incomplete by definition, so the options must be safe for any
    ending — ``is_safe_filler`` additionally rejects anything echoing a specific
    from the partial, since a cut-off sentence can mean something quite different
    from how it started.
    """
    partial = (partial_text or "").strip()
    if not partial:
        return []
    history = _format_history(
        messages, int(getattr(settings, "INTERIM_REPLY_HISTORY_TURNS", 4))
    )
    history_block = f"Conversation so far:\n\n{history}\n\n" if history else ""
    return await _generate(
        llm_client,
        scenario,
        user_content=(
            f"{history_block}"
            "The learner is mid-sentence. Partial transcript of what they are "
            f"saying right now:\n\n{partial}\n\n"
            f"Generate {count} filler options the character would utter the "
            "instant they stop. The transcript may cut off mid-thought, so every "
            "option must still make sense whatever they turn out to mean."
        ),
        count=count,
        messages=messages,
        partial_text=partial,
        timeout_s=timeout_s,
        room_id=room_id,
    )
