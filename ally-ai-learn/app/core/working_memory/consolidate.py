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
from typing import List, Optional

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

from app.core.logger import get_logger
from app.core.working_memory import monologue
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

#: Named absences for the two scenario placeholders. A scenario with no states
#: still renders the whole block, because the block is the author's prompt text
#: and Python cannot suppress it — so it has to say what is missing rather than
#: leave a blank line under a heading.
NO_AUTHORED_STAGES = "  (this scenario defines no stages)"
NO_CURRENT_STAGE = "(no stage defined — judge from the turns alone)"
#: Named absence for the opener catalog, same rule as the two above. A session
#: with no delivery layer (fillers off, or a voice that renders no clips) still
#: runs this prompt, and must read "leave it out" rather than an empty list.
NO_OPENER_CATALOG = "(no openers available this session — leave delivery empty)"

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

    Not ``render.render_sections``: that renders for the ACTOR, in the second
    person, with the withheld ledger phrased as instructions to follow. The
    updater needs a third-person record to diff against, and giving it the
    actor's block invites it to answer as the client instead of about the
    client.
    """
    lines = [
        # Labelled in the prompt-facing vocabulary, not the store's.
        # `memory.stance` is the store's mirror of the author's resolved
        # state, and the template calls that `{current_state}`; a
        # digest labelling it `stance` made the model read two names for
        # one thing. Same for `register`, which is what the template asks
        # for and what the actor prompt renders.
        f"state: {memory.stance} (for {memory.turns_in_stance} turn(s))",
        f"affect: {memory.affect or '(unset)'}",
        f"appraisal: {memory.appraisal or '(unset)'}",
        f"register: {memory.register or '(unset)'}",
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
    locked = [w.topic for w in memory.withheld if w.status == "unsaid"]
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


async def consolidate(
    *,
    memory: ClientWorkingMemory,
    new_messages: List[BaseMessage],
    llm_client: BaseLLMClient,
    prompt_data=None,
    room_id: Optional[str] = None,
    authored_stance: Optional[str] = None,
    opener_catalog: Optional[str] = None,
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
    _ladder = tuple(memory.ladder or ())
    _guidance_by_name = {
        str(st.get("name") or "").strip(): _coerce_guidance(st.get("guidelines"))
        for st in (getattr(prompt_data, "states", None) or [])
        if isinstance(st, dict)
    }
    state_ladder = "\n".join(
        f"  {i + 1}. {name}"
        + (f" — {_guidance_by_name[name]}" if _guidance_by_name.get(name) else "")
        for i, name in enumerate(_ladder)
    )
    system_text = load_and_format(
        _TEMPLATE_PATH,
        prompt_data,
        language_label=language_label,
        # Data, not prose. The sentences that frame these live in the template
        # where a reader of the prompt can see them; Python only supplies the
        # author's stages and which one the score resolved to.
        #
        # Named absences rather than blanks, the same rule `render.py` applies
        # to every section it fills: a blank line under "these stages" reads to
        # the model as an absence of constraint, where a named absence reads as
        # an absence of data. A scenario with no states has no progression for
        # anyone to adjudicate, and the closing instruction already tells the
        # model what to do then — judge from the turns.
        state_ladder=state_ladder or NO_AUTHORED_STAGES,
        current_state=authored_stance or NO_CURRENT_STAGE,
        opener_catalog=opener_catalog or NO_OPENER_CATALOG,
    )
    if not system_text:
        logger.warning("[working-memory] updater template resolved empty; skipping")
        return None

    # What the client already told this counsellor in EARLIER sessions (a case
    # or a track), which ally-be sends as one ready-made sentence. The ledger
    # starts empty every session, so without it the updater reports last
    # session's disclosures as new the moment they resurface, and can record a
    # topic as withheld that the counsellor has already heard.
    previous_memory = (getattr(prompt_data, "previous_memory", None) or "").strip()
    earlier_sessions = (
        "From earlier sessions with this counsellor (already said; never report "
        "any of it as newly disclosed or as withheld):\n"
        f"{previous_memory}\n\n"
        if previous_memory
        else ""
    )

    user_text = (
        earlier_sessions + "Current client state:\n"
        f"{_digest(memory)}\n\n"
        "Newest conversation turns:\n"
        f"{turns_text}\n\n"
        # Repeated here deliberately: this is the last thing the model reads
        # before it answers, and the failure being prevented is an instruction
        # at the top of a long prompt losing to the pull of the examples.
        f"Reply with every field written in {language_label}. "
        # speech_fragments is the one field the actor imitates for voice, so a
        # stray phrase in another language compounds: prod session df4eb7f3 (an
        # English sim) recorded the client's "koi baat nahi" as a fragment, and
        # within two turns every reply and every fragment was Hinglish.
        f"speech_fragments in particular: drop any phrase that is not in "
        f"{language_label}, even if the client said it."
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
    return validate(proposal, memory, new_messages, authored_stance=authored_stance)


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


async def _select_salient(
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
    last_learner_text = _last_learner_text(new_messages)
    selected, scored = select(
        corpus.facts,
        turn_index=memory.turn_index,
        stance=stance,
        cues=update.retrieve_cues,
        last_learner_text=last_learner_text,
        scenario_context=scenario_context,
        vectors=corpus.vectors or None,
        query_vec=query_vec,
    )

    # Ship what recall CONSIDERED, not only what it chose. `select` has always returned
    # this
    # and every call site has thrown it away, which left the weights on cue hits,
    # similarity,
    # encoding strength and decay tunable only by argument — the thing its own docstring
    # said
    # the return value was for.
    await _report_recall(
        update=update,
        memory=memory,
        stance=stance,
        last_learner_text=last_learner_text,
        scenario_context=scenario_context,
        selected=selected,
        scored=scored,
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


def _cue_tier(
    update: ValidatedUpdate,
    last_learner_text: Optional[str],
    scenario_context: Optional[str],
) -> str:
    """Which SOURCE supplied this turn's cues, mirroring recall's own fallback ladder.

    Recorded on its own because it is the difference between recall responding to the
    conversation and recall running on encoding strength while appearing to. The first
    v2v run
    had cue_hits at 0 on every turn; a tier distribution makes that visible without
    anyone
    reading a transcript.

    Derived here rather than returned by `select` so that function keeps its signature
    and its
    single responsibility — the ladder is three conditions, and duplicating them is
    cheaper
    than threading a new return value through a hot path.
    """
    if any((cue or "").strip() for cue in (update.retrieve_cues or [])):
        return "nominated"
    if (last_learner_text or "").strip():
        return "learner_text"
    if (scenario_context or "").strip():
        return "scenario"
    return "none"


async def _report_recall(
    *,
    update: ValidatedUpdate,
    memory: ClientWorkingMemory,
    stance: str,
    last_learner_text: Optional[str],
    scenario_context: Optional[str],
    selected: List[Fact],
    scored,
) -> None:
    """Best-effort telemetry for one recall. Never affects the update."""
    try:
        from app.core.graph.instrumentation import get_room_id
        from app.core.working_memory.recall_log import emit_recall
        from app.core.working_memory.state import SALIENT_BACKSTORY_CAP

        await emit_recall(
            room_id=get_room_id(),
            turn_index=memory.turn_index,
            stance=stance,
            cue_tier=_cue_tier(update, last_learner_text, scenario_context),
            cue_count=len(
                [c for c in (update.retrieve_cues or []) if (c or "").strip()]
            ),
            scored=scored,
            selected_texts=[f.text for f in selected],
            cap=SALIENT_BACKSTORY_CAP,
        )
    except Exception:  # noqa: BLE001
        logger.debug("[working-memory] recall telemetry skipped", exc_info=True)


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
    authored_stance: Optional[str] = None,
    # ---- DISPLAY ONLY, for the internal-monologue panel ----
    # These three exist solely so the preview can explain WHY the client moved.
    # Nothing here influences the update: `score` and `credited_behaviours` are
    # never read by `validate`, which takes `authored_stance` verbatim. They
    # were removed from this signature when the stance ladder was deleted; if
    # you find yourself passing them into a decision, the ladder has come back
    # and that is the bug.
    room=None,
    score: Optional[int] = None,
    credited_behaviours: Optional[List[str]] = None,
    # Titles of trainer-locked memories the actor's prompt carried this turn
    # (knowledge_locks.py). Display only: they are authored, so they reach the
    # panel's re-rendered sections and never the store.
    locked_topics: Optional[List[str]] = None,
    # The session's opener catalog as the prompt lists it, and where an
    # accepted delivery plan goes. Both None when the session has no delivery
    # layer, in which case the prompt is told to leave delivery empty.
    opener_catalog: Optional[str] = None,
    on_delivery=None,
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
                    authored_stance=authored_stance,
                    opener_catalog=opener_catalog,
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
            await store.mark_miss()
            # Report the miss: this turn ran on last turn's memory, and a
            # curator watching the client behave oddly needs the cause visible.
            await monologue.publish_and_record(
                room,
                store,
                monologue.build_payload(
                    memory=memory,
                    update=None,
                    turn_index=turn_index,
                    score=score,
                    prompt_data=prompt_data,
                    messages=new_messages,
                    missed=True,
                    locked_topics=locked_topics,
                ),
            )
            return
        except asyncio.CancelledError:
            # Session teardown via discard(). Not a miss — nobody will read it.
            raise
        except Exception as exc:  # noqa: BLE001 - a miss must not kill the turn
            logger.warning(
                "[working-memory] update for turn %d failed: %s", turn_index, exc
            )
            await store.mark_miss()
            # Report the miss: this turn ran on last turn's memory, and a
            # curator watching the client behave oddly needs the cause visible.
            await monologue.publish_and_record(
                room,
                store,
                monologue.build_payload(
                    memory=memory,
                    update=None,
                    turn_index=turn_index,
                    score=score,
                    prompt_data=prompt_data,
                    messages=new_messages,
                    missed=True,
                    locked_topics=locked_topics,
                ),
            )
            return

        if update is None:
            return

        # The delivery plan is for the VERY NEXT learner turn, so it is handed
        # over before recall and the commit rather than after them — it depends
        # on neither, and every millisecond here is a chance the learner has
        # already finished speaking.
        if on_delivery is not None and update.delivery is None:
            # Otherwise indistinguishable from a session with no delivery layer:
            # the next turn silently keeps the previous (or default) plan.
            logger.info(
                "[working-memory] turn %d: the update carried no delivery plan",
                turn_index,
            )
        if on_delivery is not None and update.delivery is not None:
            try:
                on_delivery(update.delivery, turn_index)
            except Exception:  # noqa: BLE001 - a plan must not cost the commit
                logger.warning(
                    "[working-memory] delivery plan hand-off failed", exc_info=True
                )

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
        salient = await _select_salient(
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
            # Publish the turn to the preview's internal-monologue panel. After
            # the commit so the panel shows what was actually kept, and awaited
            # inside the detached task so it costs the reply path nothing.
            await monologue.publish_and_record(
                room,
                store,
                monologue.build_payload(
                    memory=memory,
                    update=update,
                    turn_index=turn_index,
                    score=score,
                    prompt_data=prompt_data,
                    advancing_behaviours=credited_behaviours,
                    messages=new_messages,
                    locked_topics=locked_topics,
                ),
            )
            logger.info(
                "[working-memory] turn %d committed (%s): stance=%s "
                "disclosed=%d withheld=%d threads=%+d",
                turn_index,
                reason,
                update.stance or "unchanged",
                len(update.disclosed),
                len(update.withheld),
                len(update.opened_threads) - len(update.closed_threads),
            )

    store._task = asyncio.create_task(_update_in_background())
    return True
