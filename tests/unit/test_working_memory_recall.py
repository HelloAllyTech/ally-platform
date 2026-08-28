"""The salience function — which memories the client currently has in mind.

Selection structure is salvaged from roleplay_v2's persona_bible (design §9.1);
the scoring is §7.4. Every coefficient in the module is an invented starting
point, so these tests pin the ORDERING PROPERTIES each named effect is supposed
to produce, never the numbers. A test asserting `score == 3.4` would fail the
first time someone tunes a coefficient, which is exactly what the module is
designed to allow.
"""

from app.core.working_memory import Fact
from app.core.working_memory.recall import score_fact, select


def f(text, **kw):
    return Fact(text=text, **kw)


def _order(selected):
    return [x.text for x in selected]


# ---------------------------------------------------------------------------
# Encoding specificity — the cue is the key
# ---------------------------------------------------------------------------


def test_a_cued_fact_outranks_a_stronger_uncued_one():
    # This is the whole design: relevance to what is being discussed beats raw
    # importance. Otherwise the same "most important" facts render every turn.
    # 3.0 is the CEILING §7.3's formula can produce (1.0 baseline + 0.5
    # affect-laden + 0.5 deep processing + 1.0 opened a thread), so this is the
    # hardest version of the case rather than an arbitrary large number — and
    # it is what _CUE_MATCH_WEIGHT is derived from.
    selected, _ = select(
        [f("mother is unwell", encoding_strength=3.0), f("lost the job")],
        turn_index=10,
        stance="guarded",
        cues=["job"],
    )
    assert _order(selected)[0] == "lost the job"


def test_cue_matching_tolerates_inflections():
    # persona_bible's stem tolerance: "sleeping" should match the cue "sleep".
    selected, scored = select(
        [f("not sleeping well"), f("brother lives away")],
        turn_index=5,
        stance="guarded",
        cues=["sleep"],
    )
    assert _order(selected)[0] == "not sleeping well"
    assert next(s for s in scored if s.fact.text == "not sleeping well").cue_hits == 1


def test_one_cue_cannot_match_the_same_fact_twice():
    # Without the per-cue break, a fact repeating a cue word would inflate.
    a = score_fact(
        f("money money money"), turn_index=1, cues={"money"}, stance="guarded"
    )
    assert a.cue_hits == 1


def test_the_learner_utterance_is_the_cue_when_nothing_was_nominated():
    # Tier 2. The conversation is a cue even before anything has reasoned about
    # it — which is what makes turn 1 usable.
    selected, _ = select(
        [f("father drinks"), f("sister in Chennai")],
        turn_index=2,
        stance="guarded",
        cues=[],
        last_learner_text="tell me about your father",
    )
    assert _order(selected)[0] == "father drinks"


# ---------------------------------------------------------------------------
# Ebbinghaus decay — the eviction policy
# ---------------------------------------------------------------------------


def test_a_long_unrecalled_fact_ranks_below_a_fresh_equal_one():
    stale = f("old detail", encoding_strength=1.0, last_recalled_turn=0)
    fresh = f("recent detail", encoding_strength=1.0, last_recalled_turn=19)
    selected, _ = select([stale, fresh], turn_index=20, stance="guarded")
    assert _order(selected)[0] == "recent detail"


def test_decay_is_floored_so_a_dormant_fact_stays_reachable():
    # A floor of zero would make a fact unreachable even when the conversation
    # finally turns to it. Dormant, not deleted.
    ancient = f("something from turn 1", last_recalled_turn=1)
    selected, _ = select(
        [ancient, f("filler")], turn_index=500, stance="guarded", cues=["something"]
    )
    assert _order(selected)[0] == "something from turn 1"


def test_a_never_recalled_fact_is_not_penalised():
    # It has not decayed; it has not been used yet. Those are different.
    never = score_fact(f("new"), turn_index=50, cues=set(), stance="guarded")
    stale = score_fact(
        f("old", last_recalled_turn=0), turn_index=50, cues=set(), stance="guarded"
    )
    assert never.score > stale.score


# ---------------------------------------------------------------------------
# Spacing effect — distinct phases, not raw hits
# ---------------------------------------------------------------------------


def test_a_fact_seen_across_phases_beats_one_hammered_in_a_single_phase():
    spread = f("across phases", stances_seen=["guarded", "testing", "opening"])
    massed = f("one phase", stances_seen=["guarded", "guarded", "guarded"])
    selected, _ = select([massed, spread], turn_index=10, stance="disclosing")
    assert _order(selected)[0] == "across phases"


# ---------------------------------------------------------------------------
# Mood congruence — state biases accessibility
# ---------------------------------------------------------------------------


def test_a_fact_laid_down_in_the_current_stance_is_more_accessible():
    congruent = f("said while guarded", stances_seen=["guarded"])
    other = f("said while opening", stances_seen=["opening"])
    selected, scored = select([other, congruent], turn_index=5, stance="guarded")
    assert _order(selected)[0] == "said while guarded"
    assert next(s for s in scored if s.fact.text == "said while guarded").mood_congruent


# ---------------------------------------------------------------------------
# Spreading activation — coherence, and it may only promote
# ---------------------------------------------------------------------------


def test_a_neighbour_of_a_cued_fact_is_pulled_in():
    # Recalling one fact primes related ones, so the selection hangs together
    # rather than being unrelated top-k hits.
    selected, scored = select(
        [
            f("lost the job at the factory"),
            f("the factory closed in March"),
            f("cousin visited"),
        ],
        turn_index=5,
        stance="guarded",
        cues=["job"],
        cap=2,
    )
    assert "the factory closed in March" in _order(selected)
    assert next(
        s for s in scored if s.fact.text == "the factory closed in March"
    ).spread


def test_spreading_activation_never_demotes_a_cued_fact():
    # Additive and applied after the first pass, so it can only promote.
    selected, _ = select(
        [f("about money"), f("money worries at home")],
        turn_index=5,
        stance="guarded",
        cues=["money"],
        cap=1,
    )
    assert len(selected) == 1


# ---------------------------------------------------------------------------
# The 4±1 cap and the baseline tier
# ---------------------------------------------------------------------------


def test_the_capacity_cap_is_enforced():
    # Cowan's 4±1. Concise context is a SELECTED few, not a smaller dump.
    selected, _ = select(
        [f(f"fact {i}") for i in range(20)], turn_index=1, stance="guarded"
    )
    assert len(selected) == 5


def test_nothing_relevant_still_returns_grounding():
    # persona_bible's baseline: the actor is never left with an empty persona.
    selected, _ = select(
        [f("weak", encoding_strength=0.0), f("strong", encoding_strength=0.0)],
        turn_index=1,
        stance="guarded",
        cues=["utterly-unrelated"],
    )
    assert len(selected) == 2


def test_no_candidates_is_not_an_error():
    selected, scored = select([], turn_index=1, stance="guarded")
    assert selected == [] and scored == []


def test_every_candidate_is_scored_not_just_the_selected():
    # The second return value is what makes the invented coefficients tunable
    # from production rather than from argument (§7.8).
    _, scored = select(
        [f(f"fact {i}") for i in range(9)], turn_index=1, stance="guarded"
    )
    assert len(scored) == 9


def test_ties_resolve_to_the_older_memory():
    # Deterministic ordering: a tie broken by dict order would make the block
    # flicker between turns for no reason the reader can see.
    a = f("same score A", first_seen_turn=1)
    b = f("same score B", first_seen_turn=9)
    selected, _ = select([b, a], turn_index=3, stance="guarded", cap=1)
    assert _order(selected) == ["same score A"]


def test_the_scenario_description_is_the_cue_when_the_conversation_gives_nothing():
    # Tier 3. Two cases reach here and neither is exotic: the OPENING turn,
    # which has no learner text at all, and any content-free learner turn
    # ("mm-hmm", "okay"). Without it the client recalls by encoding strength
    # and decay — five true facts about themselves, but not the five this
    # session is about.
    facts = [
        Fact(text="His grandfather died a few weeks ago."),
        Fact(text="He reads at night, whatever he can find."),
        Fact(text="He is methodical and precise."),
    ]
    selected, _ = select(
        facts,
        turn_index=0,
        stance="guarded",
        cues=(),
        last_learner_text=None,
        scenario_context="Something happened at his home recently — his grandfather.",
        cap=1,
    )
    assert selected[0].text == "His grandfather died a few weeks ago."


def test_the_learner_utterance_still_outranks_the_scenario_description():
    # Tier 3 is a LAST resort: a real cue from the conversation must win, or
    # recall would stop responding to what is actually being said.
    facts = [
        Fact(text="His grandfather died a few weeks ago."),
        Fact(text="He reads at night, whatever he can find."),
    ]
    selected, _ = select(
        facts,
        turn_index=3,
        stance="opening",
        cues=(),
        last_learner_text="what do you do when you cannot sleep at night?",
        scenario_context="Something happened at his home recently — his grandfather.",
        cap=1,
    )
    assert selected[0].text == "He reads at night, whatever he can find."


def test_no_cue_anywhere_still_returns_facts():
    # Degrades to encoding strength and decay rather than returning nothing —
    # a scenario with no description must not lose recall entirely.
    facts = [
        Fact(text="He is methodical and precise."),
        Fact(text="He reads at night."),
    ]
    selected, _ = select(
        facts, turn_index=0, stance="guarded", cues=(), last_learner_text=None, cap=2
    )
    assert len(selected) == 2
