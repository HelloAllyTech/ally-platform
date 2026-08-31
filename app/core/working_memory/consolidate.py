"""The consolidation call: one off-path LLM call that updates the memory.

This is the write path, and everything about its shape is a latency decision
first and a memory-science decision second.

**It is never on the reply path.** ``CLAUDE.md`` is blunt about it: anything
added between the learner finishing a sentence and hearing a reply is a product
regression even when it is correct. The measured stakes are specific — p50 turn
latency is already 3.1s and the 5.4s+ band is where the weak metrics live, so a
second serialized round trip would not degrade the actor gradually, it would move
every turn into the worst band we measure. So the update is DETACHED, exactly as
``schedule_compaction`` detaches the rolling summary, and the turn that triggers
it does not wait for it.

**A miss is normal and must be survivable.** The update is hard-timeboxed and
failure keeps the previous memory rather than blanking it. The store counts the
miss without advancing its monotonic turn, so the next update is free to commit
and a dropped turn costs staleness rather than correctness. This is the same
bargain as compaction: the block goes stale for a turn, and ``staleness_turns``
makes that visible instead of silent.

**What comes back is untrusted.** ``proposal.validate`` decides what is
committed; see the module docstring there. This file gets the words and holds
the plumbing, and deliberately makes no judgement of its own.
"""

from __future__ import annotations

import asyncio
from typing import List, Optional, Sequence

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

from app.core.logger import get_logger
from app.core.working_memory.proposal import ProposedUpdate, ValidatedUpdate, validate
from app.core.working_memory.state import (
    ClientWorkingMemory,
    Fact,
    Thread,
    WithheldTopic,
)
from app.core.working_memory.store import ClientWorkingMemoryStore
from app.llms.base import BaseLLMClient
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)

_TEMPLATE_PATH = "system/client_working_memory_updater"

#: Turns of conversation handed to the updater. The rolling summary already
#: carries everything older, so this window only has to cover "what just
#: changed" — and a wider one would make the updater re-derive state it has
#: already committed, which is how a stance starts drifting on re-reads.
DEFAULT_WINDOW_TURNS = 6

#: Disclosures shown to the UPDATER. Smaller than the actor's render cap: the
#: actor must avoid repeating itself, while the updater only needs to avoid
#: re-reporting, and it also sees the raw turns.
_DIGEST_DISCLOSURES = 10


def _digest(memory: ClientWorkingMemory) -> str:
    """The current state, as the updater needs to see it.

    Not ``render.render_block``: that renders for the ACTOR, in the second
    person, with the withheld ledger phrased as instructions to follow. The
    updater needs a third-person record to diff against, and giving it the
    actor's block invites it to answer as the client instead of about the
    client.
    """
    lines = [
        f"stance: {memory.stance} (for {memory.turns_in_stance} turn(s))",
        f"affect: {memory.affect or '(unset)'}",
        f"appraisal: {memory.appraisal or '(unset)'}",
        f"voice_register: {memory.register or '(unset)'}",
    ]
    if memory.disclosed:
        # Bounded for the same reason the rendered block is: the first v2v run
        # showed this ledger reaching 21 items in ten exchanges, and it is sent
        # to the updater on EVERY turn as well as to the actor. That double
        # charge is why client_working_memory outspent agent_turn on prompt
        # tokens in that run (18,629 vs 18,431).
        #
        # The updater needs enough not to re-report what it already reported,
        # which the recent tail gives it — the rolling summary carries the rest.
        recent = memory.disclosed[-_DIGEST_DISCLOSURES:]
        omitted = len(memory.disclosed) - len(recent)
        prefix = (
            f"already disclosed (most recent of {len(memory.disclosed)})"
            if omitted
            else "already disclosed"
        )
        lines.append(prefix + ": " + "; ".join(f.text for f in recent))
    open_threads = [t.topic for t in memory.open_threads]
    if open_threads:
        lines.append("open threads: " + "; ".join(open_threads))
    # Topics only. The updater has no more business holding withheld content
    # than the actor does.
    locked = [w.topic for w in memory.withheld if w.status == "locked"]
    if locked:
        lines.append("currently withheld: " + "; ".join(locked))
    return "\n".join(lines)


def _format_turns(messages: List[BaseMessage]) -> str:
    """Reuse the summarizer's role mapping rather than inventing a second one.

    The agent IS the client and the learner is the counsellor. Two renderings
    of the same transcript that disagree about who "YOU" refers to would be a
    genuinely nasty bug to find.
    """
    from app.core.graph.rolling_summary import _format_turns as fmt

    return fmt(messages)


def _emit_usage(raw, llm_client: BaseLLMClient, room_id: Optional[str]) -> None:
    """Best-effort usage emission. Never raises.

    Present from the first commit because the rolling summary shipped without
    it and its cost was invisible until someone went looking — a feature whose
    spend cannot be set against its benefit cannot be argued for or killed.
    """
    try:
        from app.core.llm_usage.emitter import emit_llm_usage
        from app.core.llm_usage.extract import extract_usage_from_aimessage
        from app.core.llm_usage.tasks import LLMTask

        usage = extract_usage_from_aimessage(raw)
        if not usage:
            return
        if room_id is None:
            from app.core.graph.instrumentation import get_room_id

            room_id = get_room_id()
        llm_instance = llm_client.llm_instance
        emit_llm_usage(
            room_id=room_id,
            provider=getattr(llm_client, "provider", None),
            model=(
                getattr(llm_instance, "model_name", None)
                or getattr(llm_instance, "model", None)
            ),
            task=LLMTask.CLIENT_WORKING_MEMORY.value,
            usage=usage,
        )
    except Exception:  # noqa: BLE001 - usage must never break the update
        pass


def _coerce_guidance(value) -> str:
    """One-line form of a band's guidance, for the ladder rendering.

    Authored guidance can be several paragraphs; a rung description has to be
    a line. Collapses whitespace and truncates, because the ladder's job here
    is to let the model TELL THE RUNGS APART, not to restate the whole brief —
    the active band's full text already reaches the actor through
    `{state_x_guidelines}`.
    """
    if not isinstance(value, str):
        return ""
    flat = " ".join(value.split())
    return flat if len(flat) <= 160 else flat[:157].rstrip() + "..."


def _events_instruction(has_authored_states: bool) -> str:
    """The REPORT WHAT YOU OBSERVED section, or the one line that replaces it.

    Only ASK for events when something still reads them. `kinds` decides
    exactly one thing: whether the generic ladder advances. With authored
    states `validate` takes the author's stance verbatim and discards `kinds`
    entirely, so every event reported on that path is produced, evidenced,
    grounding-checked and then dropped — paid for in prompt tokens and in the
    model's attention, to populate one log field.
    """
    if has_authored_states:
        return (
            "REPORT WHAT YOU OBSERVED\n"
            "- events: leave this list EMPTY. Nothing reads it in this "
            "scenario. Everything worth recording goes in the fields below."
        )
    return (
        "REPORT WHAT YOU OBSERVED\n"
        "- events: the client-side things that happened in these turns. "
        "Each has a `kind`, an optional `topic`, and `evidence` quoting "
        "the span that justifies it. Use only these kinds:\n"
        "  - repair: the counsellor noticed something they had missed or "
        "gotten wrong, and addressed it\n"
        "  - resistance_softened: the client let go of a defence they were "
        "holding\n"
        "  - disclosed: the client revealed something not previously said\n"
        "  - rupture: the client felt judged, dismissed, rushed or exposed\n"
        "  Report NOTHING if nothing happened. An empty list is a correct "
        "and common answer."
    )


def _stance_instruction(has_authored_states: bool, stance_ladder: str) -> str:
    """The stance line, or the ladder rulebook when no author decides it.

    When the scenario defines states, the author's bands decide where the
    client is and `validate` takes that verbatim — so the eight lines of
    earned-advance rulebook this template used to carry were instructions for
    a decision the code no longer makes.
    """
    if has_authored_states:
        return (
            "- stance: DO NOT report this. Where the client is in the "
            "conversation is decided by the scenario, not by you. Report only "
            "the state and ledger fields below."
        )
    return (
        "- stance: where the client is on this ladder, which runs in "
        "order:\n"
        f"{stance_ladder}\n"
        "  Use these names EXACTLY as written; a name that is not on the "
        "ladder is discarded.\n"
        "  This is a PROPOSAL and it may be refused or reduced. A stance is "
        "EARNED by something the counsellor did, moves AT MOST ONE rung per "
        "update, and stays where it is when nothing advanced — that is the "
        "common answer and not a failure to report it.\n"
        "  Going DOWN needs no advancing event: a client who feels judged, "
        "rushed or exposed closes up immediately."
    )


async def consolidate(
    *,
    memory: ClientWorkingMemory,
    new_messages: List[BaseMessage],
    llm_client: BaseLLMClient,
    prompt_data=None,
    room_id: Optional[str] = None,
    score_delta: int = 0,
    advancing_behaviours: Sequence[str] = (),
    authored_stance: Optional[str] = None,
) -> Optional[ValidatedUpdate]:
    """One LLM call, then validation. Returns None when there is nothing to do.

    Raises on LLM failure — the caller decides the fallback, which is always
    "keep the previous memory and try again next turn".
    """
    turns_text = _format_turns(new_messages)
    if not turns_text.strip():
        return None

    # The language has to be NAMED, not implied.
    #
    # The template already carried "write in the same language as the
    # conversation turns" — the same line the rolling summarizer uses
    # successfully — but it was one rule among a dozen at the bottom of a
    # 4,000-character prompt, and it was resolved with `load_template`, which
    # does no formatting, so the prompt could not even say WHICH language.
    #
    # Measured in the Hindi v2v run: the conversation was Devanagari on both
    # sides and the updater returned an English ledger ("feeling nervous during
    # the alertness test"). The groundedness check then correctly found no
    # overlap with a Devanagari transcript and dropped 13 of 14 disclosures, so
    # the write-out was empty again — a different cause from the regex bug, same
    # symptom.
    language_label = (
        getattr(prompt_data, "language_label", None) or ""
    ).strip() or "the language of the conversation turns"
    # The ladder is rendered from THIS session's rungs, not hardcoded.
    #
    # It used to be five fixed names with a behavioural gloss each. Those
    # glosses were good prompt engineering, so the scenario's own bands must
    # carry their weight: each rung is rendered with the author's `guidelines`
    # where there is one, which is a fuller description than the generic line
    # it replaces, and specific to this client rather than to clients in
    # general.
    _authored_states = getattr(prompt_data, "states", None) or []
    _has_authored_states = bool(
        [st for st in _authored_states if isinstance(st, dict) and st.get("name")]
    )
    _ladder = tuple(memory.ladder or ())
    _guidance_by_name = {
        str(st.get("name") or "").strip(): _coerce_guidance(st.get("guidelines"))
        for st in (getattr(prompt_data, "states", None) or [])
        if isinstance(st, dict)
    }
    stance_ladder = "\n".join(
        f"  {i + 1}. {name}"
        + (f" — {_guidance_by_name[name]}" if _guidance_by_name.get(name) else "")
        for i, name in enumerate(_ladder)
    )
    events_instruction = _events_instruction(_has_authored_states)
    stance_instruction = _stance_instruction(_has_authored_states, stance_ladder)

    system_text = load_and_format(
        _TEMPLATE_PATH,
        prompt_data,
        language_label=language_label,
        events_instruction=events_instruction,
        stance_instruction=stance_instruction,
    )
    if not system_text:
        logger.warning("[working-memory] updater template resolved empty; skipping")
        return None

    user_text = (
        "Current client state:\n"
        f"{_digest(memory)}\n\n"
        "Newest conversation turns:\n"
        f"{turns_text}\n\n"
        # Repeated here deliberately: this is the last thing the model reads
        # before it answers, and the failure being prevented is an instruction
        # at the top of a long prompt losing to the pull of the examples.
        f"Reply with every field written in {language_label}."
    )

    # include_raw for the same reason as the summarizer: with_structured_output
    # alone returns only the parsed model, which carries no usage metadata.
    result = await llm_client.llm_instance.with_structured_output(
        ProposedUpdate, include_raw=True
    ).ainvoke(
        [
            SystemMessage(content=system_text),
            HumanMessage(content=user_text),
        ]
    )
    if isinstance(result, dict):
        proposal = result.get("parsed")
        _emit_usage(result.get("raw"), llm_client, room_id)
        if proposal is None:
            raise ValueError(
                f"working-memory structured-output parse failed: "
                f"{result.get('parsing_error')}"
            )
    else:
        # Defensive: some providers/wrappers may ignore include_raw.
        proposal = result

    # The same window the updater read, so `validate` can check the evidence it
    # produced against what was actually said.
    return validate(proposal, memory, new_messages, score_delta, advancing_behaviours)


async def apply_update(
    store: ClientWorkingMemoryStore,
    update: ValidatedUpdate,
    turn_index: int,
    salient_backstory: Optional[List[Fact]] = None,
) -> bool:
    """Commit a validated update, converting flat fields into stored records.

    The turn stamps matter: a fact and a thread both carry the turn they were
    first seen, which is what the salience function decays against. Stamping
    them at commit time rather than at observation time would make everything
    look equally fresh, and the recall order would collapse to insertion order.

    `salient_backstory` rides along in the SAME commit rather than in a second
    one, and it has to: `commit` rejects any turn index at or below the last
    committed, so a follow-up write for the same turn would be discarded as
    stale. One turn, one write.
    """
    return await store.commit(
        turn_index,
        stance=update.stance,
        affect=update.affect,
        appraisal=update.appraisal,
        register=update.register,
        speech_fragments=update.speech_fragments,
        disclosed=(
            [Fact(text=t, first_seen_turn=turn_index) for t in update.disclosed]
            if update.disclosed
            else None
        ),
        opened_threads=(
            [Thread(topic=t, opened_turn=turn_index) for t in update.opened_threads]
            if update.opened_threads
            else None
        ),
        closed_topics=update.closed_threads,
        withheld=(
            [WithheldTopic(topic=t, deflection=d) for t, d in update.withheld]
            if update.withheld
            else None
        ),
        retrieve_cues=update.retrieve_cues or None,
        salient_backstory=salient_backstory,
    )


def _last_learner_text(messages: List[BaseMessage]) -> Optional[str]:
    """The learner's most recent utterance, for recall's tier-2 cue fallback."""
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            content = getattr(message, "content", None)
            if isinstance(content, str) and content.strip():
                return content
    return None


async def _embed_query(embed_query, cues, last_learner_text) -> Optional[list]:
    """Embed this turn's query, or None on any failure.

    The query is the nominated cues plus the learner's own words — the same
    construction `persona_bible.build_semantic_retriever` used. One short
    embedding per turn, inside the detached update, so it costs the actor
    nothing.

    Never raises: recall falls back to lexical, which is the whole reason the
    semantic term is a multiplier rather than the ranking.
    """
    if embed_query is None:
        return None
    query = " ".join(
        part for part in [" ".join(cues or []), last_learner_text or ""] if part
    ).strip()
    if not query:
        return None
    try:
        vector = await embed_query(query)
    except Exception as exc:  # noqa: BLE001 - lexical recall is a fine fallback
        logger.warning(
            "[working-memory] query embedding failed (%s); recall stays lexical",
            exc,
        )
        return None
    try:
        return [float(x) for x in vector] or None
    except TypeError:
        return None


def _select_salient(
    corpus,
    *,
    update: ValidatedUpdate,
    memory: ClientWorkingMemory,
    new_messages: List[BaseMessage],
    query_vec=None,
    scenario_context: Optional[str] = None,
) -> Optional[List[Fact]]:
    """Pick what the client has in mind, or None when there is no pool.

    None rather than [] on purpose: `commit` treats None as "not part of this
    update" and an empty list as "the client is thinking about nothing". A
    scenario with no character profile should leave the field untouched, not
    assert an emptiness it cannot know.
    """
    if not corpus or not corpus.facts:
        return None

    from app.core.working_memory.recall import select

    # The stance the update just decided, not the one it started from — recall
    # should be congruent with where the client now IS.
    stance = update.stance or memory.stance
    selected, _scored = select(
        corpus.facts,
        turn_index=memory.turn_index,
        stance=stance,
        cues=update.retrieve_cues,
        last_learner_text=_last_learner_text(new_messages),
        scenario_context=scenario_context,
        vectors=corpus.vectors or None,
        query_vec=query_vec,
    )

    # Recalling a memory re-encodes it (§7.4): the spacing effect counts
    # DISTINCT phases, so a fact recalled again in the same stance must not
    # accumulate credit for it. Mutating the pool's Facts is deliberate — the
    # pool is where a session's recall history lives, and state snapshots are
    # deep-copied so no reader sees a torn write.
    for fact in selected:
        fact.last_recalled_turn = memory.turn_index
        if stance not in fact.stances_seen:
            fact.stances_seen.append(stance)

    return selected


def schedule_update(
    store: ClientWorkingMemoryStore,
    *,
    memory: ClientWorkingMemory,
    new_messages: List[BaseMessage],
    llm_client: BaseLLMClient,
    timeout: float,
    prompt_data=None,
    room_id: Optional[str] = None,
    reason: str = "cadence",
    embed_query=None,
    score_delta: int = 0,
    advancing_behaviours: Sequence[str] = (),
    authored_stance: Optional[str] = None,
) -> bool:
    """Fire the consolidation as a DETACHED task writing into ``store``.

    Returns False without scheduling when an update is already in flight — the
    monotonic commit check would reject the loser anyway, and paying for a call
    whose result is guaranteed to be discarded is worse than skipping a turn.

    ``memory`` is the snapshot ``begin_turn`` returned, NOT a fresh read: the
    update must be validated against the state the actor's prompt was actually
    built from, and it commits under that snapshot's ``turn_index``.
    """
    if store.in_flight:
        logger.debug("[working-memory] update already in flight; skipping")
        return False

    turn_index = memory.turn_index

    async def _update_in_background() -> None:
        try:
            update = await asyncio.wait_for(
                consolidate(
                    memory=memory,
                    new_messages=new_messages,
                    llm_client=llm_client,
                    prompt_data=prompt_data,
                    room_id=room_id,
                    score_delta=score_delta,
                    advancing_behaviours=advancing_behaviours,
                    authored_stance=authored_stance,
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "[working-memory] update for turn %d timed out after %ss; "
                "keeping previous memory",
                turn_index,
                timeout,
            )
            await store.mark_miss(score_delta)
            return
        except asyncio.CancelledError:
            # Session teardown via discard(). Not a miss — nobody will read it.
            raise
        except Exception as exc:  # noqa: BLE001 - a miss must not kill the turn
            logger.warning(
                "[working-memory] update for turn %d failed: %s", turn_index, exc
            )
            await store.mark_miss(score_delta)
            return

        if update is None:
            return

        # Recall runs HERE — off the reply path, after the update that produced
        # the cues, and before the single commit. Two consequences worth having:
        # this turn's nominated cues drive this turn's selection rather than the
        # next one's, and the selection costs the actor nothing because nobody
        # is waiting on it.
        # Only worth an embedding call when there is a pool with vectors to
        # compare against; otherwise the lexical path is the whole path.
        query_vec = None
        if store.corpus is not None and store.corpus.vectors:
            # Same hard timeout as the consolidation call above: `_embed_query`'s
            # own try/except only catches a call that RAISES, not one that hangs,
            # and a hung embedding call would otherwise keep `store.in_flight`
            # True (and this session's memory frozen) until the session ends.
            try:
                query_vec = await asyncio.wait_for(
                    _embed_query(
                        embed_query,
                        update.retrieve_cues,
                        _last_learner_text(new_messages),
                    ),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "[working-memory] query embedding for turn %d timed out "
                    "after %ss; recall stays lexical",
                    turn_index,
                    timeout,
                )
        salient = _select_salient(
            store.corpus,
            update=update,
            memory=memory,
            new_messages=new_messages,
            query_vec=query_vec,
            # The challenge description — what this session is ABOUT — as the
            # last-resort recall cue. Same field the branching prompt renders
            # as {challenge_description}.
            scenario_context=getattr(prompt_data, "description", None),
        )
        committed = await apply_update(store, update, turn_index, salient)
        if committed:
            logger.info(
                "[working-memory] turn %d committed (%s): stance=%s events=%s",
                turn_index,
                reason,
                update.stance or "unchanged",
                ",".join(update.events) or "none",
            )

    store._task = asyncio.create_task(_update_in_background())
    return True
