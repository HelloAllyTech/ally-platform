"""Rendering the working-memory block.

Two provenances merge here and nowhere else (design §3.1): derived fields from a
store snapshot, and the authored `state_x_guidelines` passed in from the
resolver. The tests below concentrate on the properties that are either
safety-relevant or silently wrong when broken — a leaked withheld topic reads as
a perfectly natural reply, and a blank section reads to the model as an absence
of constraint rather than as an absence of data.
"""

import app.core.graph.nodes  # noqa: F401  (settles a pre-existing import cycle)
from app.core.working_memory import ClientWorkingMemory, Fact, Thread, WithheldTopic
from app.core.working_memory.render import MAX_RENDERED_DISCLOSURES, render_block


def _memory(**kw) -> ClientWorkingMemory:
    m = ClientWorkingMemory(
        stance=kw.pop("stance", "guarded"),
        affect=kw.pop("affect", "Worn out."),
        register=kw.pop("register", "Short sentences."),
    )
    for key, value in kw.items():
        setattr(m, key, value)
    return m


# ---------------------------------------------------------------------------
# The safety-critical part
# ---------------------------------------------------------------------------


def test_a_locked_topic_renders_its_deflection_and_no_more():
    # roleplay_v2's ledger contract: the actor learns a subject exists and how
    # to move away from it. Unlike v2 there is no content field to leak at all,
    # because a derived topic never stores one — the ledger is a gate, not a
    # content store.
    block = render_block(
        _memory(withheld=[WithheldTopic("the diagnosis", "say it is nothing")])
    )
    assert "the diagnosis" in block
    assert "say it is nothing" in block
    assert "NOT talked about this" in block


def test_an_unlocked_topic_is_permitted_but_not_volunteered():
    block = render_block(
        _memory(withheld=[WithheldTopic("the diagnosis", "deflect", status="unlocked")])
    )
    assert "Do not volunteer it" in block
    assert "NOT talked about this" not in block


def test_a_revealed_topic_drops_out_of_the_withheld_section():
    # Once it is out, `disclosed` carries it. Leaving it here would have the
    # actor still guarding something it has already said.
    block = render_block(
        _memory(withheld=[WithheldTopic("the diagnosis", "deflect", status="revealed")])
    )
    assert "the diagnosis" not in block
    assert "nothing you are holding back" in block


def test_the_appraisal_is_never_rendered():
    # Scratchpad, not instruction. It exists for telemetry and debugging — the
    # think_scrubber rule, applied at assembly rather than before TTS.
    block = render_block(_memory(appraisal="they are pushing too fast and I resent it"))
    assert "resent" not in block


# ---------------------------------------------------------------------------
# Named absences, never blanks
# ---------------------------------------------------------------------------


def test_every_empty_section_says_so_in_words():
    # A blank section reads to the model as an absence of CONSTRAINT. A named
    # absence does not. Salvaged from v2's empty states.
    block = render_block(_memory(), state_guidance="Stay resistant.")
    for phrase in (
        "nothing you are holding back",
        "nothing left hanging",
        "have not told them anything yet",
        "nothing from your own life",
    ):
        assert phrase in block


def test_the_first_turn_says_the_client_has_not_spoken():
    block = render_block(_memory(), state_guidance="Open cautiously.")
    assert "this is your first reply" in block


def test_missing_state_guidance_is_named_not_blank():
    block = render_block(_memory(disclosed=[Fact("something")]))
    assert "no particular direction for this stage" in block


# ---------------------------------------------------------------------------
# Ordering — ascending churn, so the stable bytes sit highest
# ---------------------------------------------------------------------------


def test_authored_guidance_precedes_the_recalled_memories():
    # State guidance changes only on a score-band crossing; recall refreshes
    # every couple of turns. Slowest first keeps more of the block cacheable and
    # puts the freshest content nearest generation.
    block = render_block(
        _memory(salient_backstory=[Fact("brother stopped calling")]),
        state_guidance="Resist advice.",
    )
    assert block.index("Resist advice.") < block.index("brother stopped calling")


def test_voice_fragments_render_verbatim():
    # The direct repair for the 2026-08-06 regression: the rolling summary
    # carries facts and no voice, which removed the actor's only in-context
    # style exemplars. Paraphrasing them here would reintroduce the bug.
    block = render_block(_memory(speech_fragments=["I dunno, it's just...", "yeah"]))
    assert "I dunno, it's just..." in block
    assert "yeah" in block


# ---------------------------------------------------------------------------
# Nothing to say → say nothing
# ---------------------------------------------------------------------------


def test_an_untouched_memory_with_no_guidance_renders_nothing():
    # Rendering the scaffolding with every section reading "(nothing yet)" would
    # spend tokens telling the model nothing — and latency is the product.
    empty = ClientWorkingMemory()
    assert render_block(empty) == ""


def test_authored_guidance_alone_is_enough_to_render():
    # Turn one of a stateful scenario: nothing derived yet, but the scenario
    # still has something to say.
    empty = ClientWorkingMemory()
    block = render_block(empty, state_guidance="Begin closed off.")
    assert "Begin closed off." in block


def test_a_closed_thread_stops_being_unfinished():
    m = _memory(unresolved=[Thread("money", closed_turn=4)])
    block = render_block(m)
    assert "nothing left hanging" in block
    assert "money" not in block


def test_blank_fragments_are_dropped_rather_than_bulleted():
    block = render_block(_memory(speech_fragments=["  ", "", "I guess"]))
    assert block.count("- ") >= 1
    assert "-  \n" not in block


# ---------------------------------------------------------------------------
# The disclosure ledger is bounded in the PROMPT, unbounded in the store
# ---------------------------------------------------------------------------


def test_the_rendered_ledger_is_capped():
    # The first v2v run reached 21 disclosures in ten exchanges and the block
    # grew to 2777 chars. That cost lands twice — actor prompt and updater
    # digest — and client_working_memory outspent agent_turn on prompt tokens
    # in that run as a result.
    memory = ClientWorkingMemory(
        affect="tired",
        disclosed=[Fact(text=f"disclosure {i}") for i in range(25)],
    )
    block = render_block(memory)
    assert block.count("disclosure ") == MAX_RENDERED_DISCLOSURES


def test_the_cap_keeps_the_most_recent():
    # Most-recent, not most-salient: this section exists to stop the actor
    # re-introducing something as new, and what it might repeat is what it just
    # said. The oldest are already covered by the rolling summary.
    memory = ClientWorkingMemory(
        affect="tired",
        disclosed=[Fact(text=f"disclosure {i}") for i in range(25)],
    )
    block = render_block(memory)
    assert "disclosure 24" in block
    assert "disclosure 0" not in block


def test_a_short_ledger_is_rendered_whole():
    memory = ClientWorkingMemory(
        affect="tired", disclosed=[Fact(text="lost the job in March")]
    )
    assert "lost the job in March" in render_block(memory)
