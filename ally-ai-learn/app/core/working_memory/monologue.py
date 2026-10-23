"""The client's internal monologue, published to the admin preview.

Working memory already derives, per turn, everything a scenario author needs to
understand why the client behaved as it did — and until now all of it went to
CloudWatch, where a curator will never look. This module puts it on the
LiveKit data channel so the preview can render it while the session runs.

**Read-only, and off the reply path.** Called from `update_working_memory`,
which runs after `publish_done_thinking` with an edge to END, so nothing here
can delay a reply. It reads the score to DISPLAY it and never to decide
anything: working memory stopped adjudicating progression on 2026-08-31, and a
future reader should not mistake this read for the ladder coming back.

**A diagnostic instrument, not a reassurance cue.** The audience is a scenario
author or engineer working out why the client did what it did, so they can change
a prompt, a band or a profile. It therefore errs toward COMPLETENESS: every field
that explains behaviour is here, including ones a consumer-facing panel would
hide. What it leaves out is noise that explains nothing — byte counts, internal
ids, turn bookkeeping.

**Deltas for the ledgers, plus the literal rendered text.** `ValidatedUpdate` IS
the per-turn delta, so ledgers ride as "what changed this turn" rather than a
growing wall of repetition. `sections` then carries the EXACT strings the actor
was handed, because the thing being tuned is ultimately the prompt and inferring
it from a summary is guesswork. Those are re-rendered here from the same snapshot
the prompt was built from — `render_sections` is pure string formatting with no
LLM call, so this costs nothing and needs no plumbing through the graph.

The payload is structured; the SENTENCES are composed in the panel from strings
in `en.ts`. Product copy belongs where product copy lives, and a curator asking
for different wording should not need a worker deploy.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from app.core.logger import get_logger
from app.core.working_memory.proposal import ValidatedUpdate
from app.core.working_memory.state import ClientWorkingMemory

logger = get_logger(__name__)

#: LiveKit data-channel topic. Mirrors the retired director panel's "director"
#: topic convention: one topic per observer surface, so a panel can filter
#: without decoding every packet on the channel.
MONOLOGUE_TOPIC = "internal-monologue"

#: Payload discriminator, so a panel ignores anything else on the topic.
MONOLOGUE_TYPE = "monologue.turn"

#: Room-name prefix ally-be gives an admin preview (`preview-<scenarioId>-<uuid>`
#: — see `previewScenario` in scenario-session.service.ts). A learner session is
#: `ss_<uuid>`.
#:
#: This gate exists because `publish_data` with no `destination_identities`
#: BROADCASTS to every participant in the room, and in a learner session the
#: learner is one. The payload carries the character's private appraisal OF THE
#: LEARNER and the literal prompt text; neither belongs on a wire a learner's
#: browser is listening to, whatever the UI chooses to render. Admin-only in the
#: UI is not admin-only on the network.
PREVIEW_ROOM_PREFIX = "preview-"


def is_preview_room(room: Any) -> bool:
    """Whether this room is an admin preview rather than a learner session."""
    name = getattr(room, "name", None)
    return isinstance(name, str) and name.startswith(PREVIEW_ROOM_PREFIX)


#: Cap on how many ledger items ride in one payload. A turn that disclosed more
#: than this is already unusual, and the panel is for reading, not auditing —
#: the full ledger lives in the session record either way.
_MAX_ITEMS = 6


def _behaviour_labels(
    prompt_data: Any, behaviour_ids: List[str]
) -> List[Dict[str, Any]]:
    """Resolve credited behaviour ids to their author-written descriptions.

    An id tells a curator nothing. "Reflect back before moving on" tells them
    which of their own behaviours the counsellor hit, which is the whole point
    of showing events at all.
    """
    if not behaviour_ids:
        return []
    by_id: Dict[str, Dict[str, Any]] = {}
    for bi in getattr(prompt_data, "behavior_instructions", None) or []:
        bid = getattr(bi, "behavior_instruction_id", None)
        if not bid:
            continue
        behaviours = getattr(bi, "behaviors", None) or []
        by_id[str(bid)] = {
            "label": (behaviours[0] if behaviours else "").strip(),
            "score": getattr(bi, "score", None),
        }
    out: List[Dict[str, Any]] = []
    for bid in behaviour_ids[:_MAX_ITEMS]:
        hit = by_id.get(str(bid))
        # Unresolvable ids are still worth reporting: a credited behaviour the
        # scenario no longer defines is itself a curation finding.
        out.append(
            {
                "label": (hit or {}).get("label") or f"(behaviour {bid})",
                "score": (hit or {}).get("score"),
            }
        )
    return out


def _rendered_sections(
    memory: ClientWorkingMemory, locked_topics: Optional[List[str]] = None
) -> Dict[str, str]:
    """The exact `{working_memory_*}` values the actor was handed this turn.

    Re-rendered from the snapshot the prompt was built from, which is the same
    input `_build_behavior_prompt` used, so the strings match what the model
    actually saw. Pure formatting, no LLM call. Wrapped because a rendering
    failure must not cost the panel the rest of the payload.
    """
    try:
        from app.core.working_memory.render import render_sections

        out: Dict[str, str] = {}
        # Trainer-locked memory titles go in exactly as the actor's prompt had
        # them; without them this would silently differ from what it claims to
        # be — the literal text the actor was handed.
        rendered = render_sections(memory, locked_topics=locked_topics or ())
        for key, value in rendered.items():
            text = (value or "").strip()
            # Drop named absences. `render.py` deliberately renders "(nothing
            # left hanging)" rather than a blank, because a blank reads to the
            # MODEL as an absence of constraint — but to a curator it is pure
            # noise, and on an early turn most sections are absences, which
            # buries the two that carry information. Every absence in that
            # module is a parenthesised whole string, which is what this
            # matches; a real value never is.
            if text.startswith("(") and text.endswith(")"):
                continue
            if not text:
                continue
            out[key.replace("working_memory_", "")] = text
        return out
    except Exception:  # noqa: BLE001
        return {}


def _last_exchange(messages: Any) -> Dict[str, Optional[str]]:
    """The counsellor line and client reply this turn's update was derived from.

    Without these the record is unreadable after the fact: "moved from Circling
    to Getting specific" means nothing when you cannot see what was said to
    cause it. Live, the transcript sits beside the panel and this is merely
    convenient; stored, it is the difference between a usable record and a list
    of assertions.

    Reads the tail of the window the updater actually saw, so the quoted lines
    are the ones the inference was made from rather than whatever happened to be
    latest by the time this ran.
    """
    counsellor: Optional[str] = None
    client: Optional[str] = None
    try:
        for message in reversed(list(messages or [])):
            content = getattr(message, "content", None)
            if not isinstance(content, str) or not content.strip():
                continue
            # The agent IS the client, so an AI message is the client speaking.
            is_client = message.__class__.__name__.startswith("AI")
            if is_client and client is None:
                client = content.strip()
            elif not is_client and counsellor is None:
                counsellor = content.strip()
            if counsellor and client:
                break
    except Exception:  # noqa: BLE001
        pass
    return {"counsellorSaid": counsellor, "clientSaid": client}


def build_payload(
    *,
    memory: ClientWorkingMemory,
    update: Optional[ValidatedUpdate],
    turn_index: int,
    score: Optional[int],
    prompt_data: Any = None,
    advancing_behaviours: Optional[List[str]] = None,
    messages: Any = None,
    missed: bool = False,
    locked_topics: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """One turn of the monologue.

    `update` is None when the turn's update timed out. That case is reported
    rather than skipped: a curator watching the client behave oddly needs to
    know the memory went stale, otherwise the oddity has no visible cause.
    """
    stance_from = None
    stance_to = memory.stance
    if update and update.stance and update.stance != memory.stance:
        stance_from, stance_to = memory.stance, update.stance

    def _texts(items) -> List[str]:
        return [t for t in (items or [])][:_MAX_ITEMS]

    return {
        "type": MONOLOGUE_TYPE,
        "turn": turn_index,
        # The exchange this turn's reasoning was derived from. Anchors the card
        # so a reader revisiting the session knows what prompted the change.
        **_last_exchange(messages),
        # Where the client is. `stanceFrom` is present only on a transition, so
        # the panel can phrase a move differently from a hold.
        "stanceFrom": stance_from,
        "stanceTo": stance_to,
        "turnsInStance": memory.turns_in_stance,
        "arc": list(memory.ladder or ()),
        "score": score,
        # The private half. `appraisal` is never sent to the actor (it is
        # scratchpad by design), which makes it the one genuinely hidden thought
        # in the system and the most useful thing on this panel.
        "affect": (update.affect if update else None) or memory.affect or None,
        "appraisal": (update.appraisal if update else None) or memory.appraisal or None,
        "register": (update.register if update else None) or memory.register or None,
        # Deltas for this turn.
        "disclosed": _texts(update.disclosed) if update else [],
        "withheld": (
            [{"topic": t, "deflection": d} for t, d in (update.withheld or [])][
                :_MAX_ITEMS
            ]
            if update
            else []
        ),
        "threadsOpened": _texts(update.opened_threads) if update else [],
        "threadsClosed": _texts(update.closed_threads) if update else [],
        # What the client actually had in mind, and what the updater flagged to
        # bring back next turn. Recall is invisible today, and a pool that keeps
        # surfacing one fact is a profile that never split into facts.
        "recalled": [f.text for f in (memory.salient_backstory or [])][:_MAX_ITEMS],
        "retrieveCues": _texts(update.retrieve_cues) if update else [],
        "events": _behaviour_labels(prompt_data, advancing_behaviours or []),
        # The literal strings the actor was handed this turn, per placeholder.
        # For prompt tuning this is the ground truth: everything else on this
        # panel is a description of the client's state, while this is the text
        # that actually shaped the reply.
        "sections": _rendered_sections(memory, locked_topics),
        # Health. A missed update means this turn ran on last turn's memory.
        "missed": bool(missed),
        "updatesMissed": memory.updates_missed,
    }


async def publish(room: Any, payload: Dict[str, Any]) -> bool:
    """Push one payload to the room. Never raises into the caller.

    Failure here must be invisible to the session: this is an observability
    surface, and a preview panel not updating is not worth risking a live
    conversation over.
    """
    if room is None:
        return False
    try:
        local = getattr(room, "local_participant", None)
        if local is None:
            return False
        await local.publish_data(
            json.dumps(payload).encode("utf-8"),
            topic=MONOLOGUE_TOPIC,
            reliable=True,
        )
        return True
    except Exception:  # noqa: BLE001 - observability must not break a turn
        logger.debug(
            "[working-memory] internal-monologue publish failed for turn %s",
            payload.get("turn"),
            exc_info=True,
        )
        return False


#: How many turns of monologue are kept for later review. A session long enough
#: to exceed this is one where the early turns have already been read or never
#: will be, and the record rides in a jsonb column that should not grow without
#: a ceiling — roughly 1.5KB per turn including the rendered sections.
MAX_RECORDED_TURNS = 30


async def publish_and_record(room: Any, store: Any, payload: Dict[str, Any]) -> bool:
    """Publish one turn live AND keep it for later review.

    Two audiences, one payload: the preview panel reads the live packet, and the
    session-detail view reads the recorded array after the fact.

    Recording is unconditional — it must survive a preview nobody was watching,
    which is the normal case for a learner session. Publishing is NOT: it only
    happens in an admin preview room, because the data channel is broadcast and
    a learner is a participant in their own session. Returns whether it was
    published live, not whether it was recorded.
    """
    recorded = getattr(store, "monologue", None)
    if isinstance(recorded, list):
        recorded.append(payload)
        if len(recorded) > MAX_RECORDED_TURNS:
            del recorded[: len(recorded) - MAX_RECORDED_TURNS]
    # Recording is unconditional; the LIVE broadcast is not. A learner session
    # records for later review in the admin dashboard but never puts the
    # appraisal or the prompt text on the room's data channel.
    if not is_preview_room(room):
        return False
    return await publish(room, payload)
