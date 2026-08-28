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
from app.core.working_memory.render import (
    MAX_RENDERED_DISCLOSURES,
    SECTION_VARIABLES,
    render_block,
    render_sections,
)


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


def test_the_cap_is_configurable_so_it_can_be_A_B_tested(monkeypatch):
    # The cap became a setting because prod showed it was not the growth
    # driver it was assumed to be: across five languages the ledgers reached
    # 3-10 disclosures, so a cap of 12 never once bound, while the block still
    # grew ~600 tokens over seven turns. Moving it has to be measurable rather
    # than a constant someone edits and redeploys.
    from app.core.config import settings

    monkeypatch.setattr(
        settings, "CLIENT_WORKING_MEMORY_MAX_RENDERED_DISCLOSURES", 4, raising=False
    )
    memory = ClientWorkingMemory(
        affect="tired",
        disclosed=[Fact(text=f"disclosure {i}") for i in range(25)],
    )
    block = render_block(memory)
    assert block.count("disclosure ") == 4
    # Still the most recent, not the oldest.
    assert "disclosure 24" in block
    assert "disclosure 0" not in block


def test_an_unreadable_cap_setting_falls_back_to_the_default(monkeypatch):
    # A config problem must degrade to the old behaviour, never break a turn.
    from app.core.working_memory import render as render_mod

    monkeypatch.setattr(
        render_mod, "_rendered_disclosure_cap", lambda: MAX_RENDERED_DISCLOSURES
    )
    memory = ClientWorkingMemory(
        affect="tired",
        disclosed=[Fact(text=f"disclosure {i}") for i in range(25)],
    )
    assert render_block(memory).count("disclosure ") == MAX_RENDERED_DISCLOSURES


# ---------------------------------------------------------------------------
# The split form: one placeholder per section
# ---------------------------------------------------------------------------
#
# Why it exists: the block form absorbed `{state_x_guidelines}`, so a designer
# opening a main-agent prompt could no longer see their own state guidance in
# it, and a non-technical reader read the absence as "that was removed". One
# opaque placeholder also gave a curator nothing to experiment with.


def test_every_section_renders_even_when_the_memory_is_untouched():
    # The property the block form gets to opt out of and this one cannot.
    # `render_block` returns "" for an untouched memory because rendering its
    # own scaffolding to say "(nothing yet)" seven times buys nothing. Here the
    # headings belong to the AUTHOR's prompt text, so a blanked value leaves a
    # bare heading — and a bare heading reads to the model as an absence of
    # CONSTRAINT, which is the exact failure the named absences exist to stop.
    sections = render_sections(ClientWorkingMemory())

    assert set(sections) == set(SECTION_VARIABLES)
    assert all(text.strip() for text in sections.values())
    assert "(nothing you are holding back right now)" in (
        sections["working_memory_withheld"]
    )
    assert "(you have not told them anything yet)" in (
        sections["working_memory_disclosed"]
    )


def test_a_section_value_is_derived_data_and_nothing_else():
    # The inverse of what this file asserted when the split form shipped.
    #
    # The three static sentences — the earned-advance discipline, the
    # do-not-re-introduce rule, the voice lead-in — used to be baked into these
    # values so a curator could not delete them. That hid the single most
    # important instruction in the block behind a placeholder name, from the
    # people being asked to curate it: a reader saw `{working_memory_stance}`
    # with no way to know a behavioural constraint arrived with it. They are
    # literal text in the prompt body now, and what stays here is only what
    # cannot be literal text — the values that depend on runtime state.
    sections = render_sections(
        _memory(
            speech_fragments=["I dunno."],
            disclosed=[Fact("she moved out in March")],
        )
    )

    assert sections["working_memory_stance"] == "You are guarded right now. Worn out."
    assert "has to be earned" not in sections["working_memory_stance"]
    assert "Do not re-introduce" not in sections["working_memory_disclosed"]
    assert "sound like the person" not in sections["working_memory_speech_fragments"]
    # the derived data itself is still there
    assert "she moved out in March" in sections["working_memory_disclosed"]
    assert "I dunno." in sections["working_memory_speech_fragments"]


def test_the_constraints_are_visible_in_the_prompt_body():
    # They have to live SOMEWHERE, and the point of moving them is that a
    # curator can read them. If a future edit drops one from the template this
    # fails, which is the whole trade: visible and diffable beats hidden and
    # unremovable.
    from pathlib import Path

    body = Path(
        "app/prompts/system/main_agent_prompt_working_memory_split.txt"
    ).read_text(encoding="utf-8")

    # Assert on fragments that survive the template's line wrapping — the
    # stance sentence wraps mid-phrase ("has to be\nearned"), so matching the
    # whole clause would fail on formatting rather than on substance.
    # The stance-discipline paragraph is deliberately GONE: it was the
    # instruction that made working memory authoritative over the author's
    # flow. The two that remain are about not repeating yourself and sounding
    # like yourself — context, not progression.
    assert "Do not move past this on your own." not in body
    assert "Do not re-introduce these as if they were new." in body
    assert "sound like the person who said these" in body


def test_the_split_form_does_not_render_state_guidance():
    # It is the authored half (§3.1) and it has had `{state_x_guidelines}` of
    # its own since long before this feature. The split form's whole purpose is
    # to stop swallowing it, so rendering it here would restore the bug.
    sections = render_sections(_memory())

    assert not any("state_guidance" in name for name in sections)
    assert not any(
        "(no particular direction for this stage)" in t for t in sections.values()
    )


def test_the_disclosure_cap_binds_in_the_split_form_too():
    # Same store, same cap. A curator moving a section must not accidentally
    # opt out of the bound that keeps the prompt from growing all session.
    many = [Fact(f"fact {i}") for i in range(MAX_RENDERED_DISCLOSURES + 6)]
    rendered = render_sections(_memory(disclosed=many))["working_memory_disclosed"]

    # Count bullet LINES, not "\n- " — the value now starts at the first
    # bullet rather than after a lead sentence, so the separator form would
    # silently under-count by one and this test would be checking cap-1.
    assert len(rendered.splitlines()) == MAX_RENDERED_DISCLOSURES
    assert "fact 0" not in rendered  # oldest dropped, newest kept
    assert f"fact {len(many) - 1}" in rendered


def test_a_locked_topic_still_cannot_leak_in_the_split_form():
    sections = render_sections(
        _memory(withheld=[WithheldTopic("the diagnosis", "say it is nothing")])
    )
    withheld = sections["working_memory_withheld"]

    assert "the diagnosis" in withheld
    assert "say it is nothing" in withheld
    # and it must not have wandered into a neighbouring section
    assert not any(
        "the diagnosis" in text
        for name, text in sections.items()
        if name != "working_memory_withheld"
    )


def test_the_split_form_is_not_a_telemetry_blackout(caplog):
    # `render_block` is never called on the split path, so without its own line
    # a split session emits no size telemetry at all. The per-section sizes are
    # what found the backstory bug — one 1721-char fact that was 64% of the
    # block while every ledger COUNT looked healthy.
    import logging

    with caplog.at_level(logging.INFO):
        render_sections(_memory(disclosed=[Fact("she moved out in March")]))

    line = next(
        r.getMessage() for r in caplog.records if "rendered sections" in r.getMessage()
    )
    assert "chars total" in line
    for name in SECTION_VARIABLES:
        assert f"{name.removeprefix('working_memory_')}=" in line
