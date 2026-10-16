"""The delivery plan: catalog, validation, turn-time rubric, playback, shaping.

Each class drives one layer through its public entry point. The rubric these
enforce (product, 2026-10-16): pause first, then at most one filler chosen from
the plan's own suggestions, then the interim piece by piece while the wait
lasts, with lengthening gaps and a beat before the reply; never the same sound
twice running, nothing over the learner, nothing before a goodbye.
"""

from __future__ import annotations

import asyncio
import random
import types
import wave

import pytest

from app.core.livekit.delivery import (
    DEFAULT_PLAN,
    DeliveryPlan,
    OpenerRecord,
    ProposedDelivery,
    TurnDelivery,
    repeats_recent_line,
    validate_delivery,
)
from app.core.livekit.filler_clips import FillerClip
from app.core.livekit.gap_predictor import GapPredictor
from app.core.livekit.opener_catalog import build_session_catalog, primary_language
from app.core.livekit.opener_policy import (
    OpenerPolicy,
    PolicyConfig,
    learner_is_leaving,
    learner_seems_unfinished,
)
from app.core.livekit.reply_shaping import AudioTagLimiter, LeadingHesitationTrimmer
from app.core.metrics import turn_metrics


def _durations(catalog, ms=600.0):
    return {entry_id: ms for entry_id in catalog.entries}


# ---------------------------------------------------------------------------
# Gap predictor: one observation per turn, the SUM of its two halves
# ---------------------------------------------------------------------------


class TestGapPredictorPairsTheHalves:
    def test_a_turn_is_llm_plus_tts_not_their_mean(self):
        p = GapPredictor(prior_ms=900.0, min_samples=1)
        p.observe_llm_ttft(900.0)
        p.observe_tts_ttfb(350.0)
        assert p.predict_ms() == pytest.approx(1250.0)

    def test_per_sentence_tts_metrics_count_once(self):
        """Per-sentence TTS paths emit a metric per sentence; the first counts."""
        p = GapPredictor(prior_ms=900.0, alpha=1.0, min_samples=1)
        p.observe_llm_ttft(1000.0)
        for _ in range(3):
            p.observe_tts_ttfb(300.0)
        assert p.samples == 1
        assert p.predict_ms() == pytest.approx(1300.0)

    def test_a_lone_tts_metric_is_ignored(self):
        """A clip rendered off the session instance is not a reply."""
        p = GapPredictor(prior_ms=900.0, min_samples=1)
        p.observe_tts_ttfb(300.0)
        assert p.samples == 0

    def test_prediction_tracks_the_real_gap(self):
        rng = random.Random(1)
        p = GapPredictor(prior_ms=900.0)
        errors = []
        for turn in range(20):
            llm, tts = rng.gauss(900, 150), rng.gauss(350, 60)
            if turn >= 4:
                errors.append(p.predict_ms() / (llm + tts))
            p.observe_llm_ttft(llm)
            p.observe_tts_ttfb(tts)
        # Previously ~0.45; now centred on the truth.
        assert 0.85 < sorted(errors)[len(errors) // 2] < 1.15


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


class TestGapPredictorLearnsTheRealWait:
    """Prod V2V 2026-10-16: the component sum read ~0.8x the real wait, so the
    interim never fit while 1.1-1.5 s of silence followed the filler."""

    def test_a_measured_wait_replaces_the_component_estimate(self):
        p = GapPredictor(prior_ms=2500.0, min_samples=2)
        for _ in range(3):
            p.observe_llm_ttft(1200.0)
            p.observe_tts_ttfb(1000.0)
        assert p.predict_ms() == pytest.approx(2200.0)
        p.observe_wait(2900.0)
        assert p.predict_ms() == pytest.approx(2900.0)  # one is enough
        # Component timings no longer pull it back down.
        p.observe_llm_ttft(1200.0)
        p.observe_tts_ttfb(1000.0)
        assert p.predict_ms() == pytest.approx(2900.0)
        p.observe_wait(3100.0)
        assert 2900.0 < p.predict_ms() < 3100.0

    def test_nonsense_waits_are_ignored(self):
        p = GapPredictor(prior_ms=2500.0)
        for bad in (None, 0, -5, "x"):
            p.observe_wait(bad)
        assert p.predict_ms() == 2500.0


class TestSessionCatalog:
    def test_the_catalog_file_ships(self):
        """It must be tracked by git: under a ``data/`` dir it was gitignored and
        the first deploy ran with no catalog at all."""
        import shutil
        import subprocess

        from app.core.livekit import opener_catalog

        assert opener_catalog._DATA_PATH.is_file()
        assert opener_catalog.catalog_available()
        if shutil.which("git") is None:
            pytest.skip("git not available")
        ignored = subprocess.run(
            ["git", "check-ignore", "-q", str(opener_catalog._DATA_PATH)],
            capture_output=True,
        )
        assert ignored.returncode == 1, "opener_catalog.json is gitignored"

    def test_primary_language(self):
        assert primary_language("hi-IN") == "hi"
        assert primary_language(None) == "en"

    def test_native_script_only_never_an_english_fallback(self):
        """Indic TTS spells Latin text letter by letter ("hmm" in Marathi)."""
        catalog = build_session_catalog("mr-IN")
        texts = {e.text for e in catalog.entries.values() if e.text}
        assert "हम्म." in texts
        assert not any(t.isascii() for t in texts)

    def test_every_supported_language_has_vocal_openers(self):
        for code in ("en-IN", "hi-IN", "mr-IN", "ta-IN", "kn-IN", "te-IN", "bn-IN"):
            catalog = build_session_catalog(code)
            kinds = {e.kind for e in catalog.entries.values()}
            assert {"hum", "hesitation"} <= kinds, code

    def test_studio_fillers_extend_the_catalog(self):
        catalog = build_session_catalog("en-IN", studio_fillers=["You know…", "Hmm."])
        assert catalog.get("studio:you know…") is not None
        # Already in the curated set: not added twice.
        assert catalog.get("studio:hmm.") is None

    def test_asset_entries_need_the_file_and_a_gender(self, tmp_path):
        """A breath in the wrong voice is worse than none."""
        assert (
            build_session_catalog("en-IN", asset_dir=tmp_path, gender="female").get(
                "breath_in"
            )
            is None
        )
        with wave.open(str(tmp_path / "breath_in_female.wav"), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(b"\x00\x00" * 2400)
        entry = build_session_catalog("en-IN", asset_dir=tmp_path, gender="Female").get(
            "breath_in"
        )
        assert entry is not None and entry.is_asset
        assert entry.asset_path.endswith("breath_in_female.wav")
        for unknown in (None, "non-binary", ""):
            assert (
                build_session_catalog("en-IN", asset_dir=tmp_path, gender=unknown).get(
                    "breath_in"
                )
                is None
            )
        assert (
            build_session_catalog("en-IN", asset_dir=tmp_path, gender="male").get(
                "breath_in"
            )
            is None
        )

    def test_the_sigh_recording_is_out_of_the_catalog(self):
        """Prod 2026-10-02: the sigh recording before a reply was annoying in a
        live session. A "sigh" plan maps to the nearest spoken kind instead."""
        catalog = build_session_catalog("en-IN", gender="female")
        assert catalog.get("sigh_soft") is None
        plan = validate_delivery(
            ProposedDelivery(opener_kind="sigh"), catalog, source="working_memory"
        )
        assert plan.opener_kind == "reflective"

    def test_the_shipped_breath_asset_loads(self):
        from app.core.livekit.opener_catalog import load_asset_clip

        for gender in ("female", "male"):
            catalog = build_session_catalog("hi-IN", gender=gender)
            for entry_id, (lo, hi) in (("breath_in", (300, 1500)),):
                entry = catalog.get(entry_id)
                assert entry is not None, (gender, entry_id)
                clip = load_asset_clip(entry)
                assert clip is not None and clip.frames, (gender, entry_id)
                assert lo <= clip.duration_ms <= hi, (gender, entry_id)
                assert clip.filler_type in ("breath", "sigh")

    def test_prompt_description_lists_ids_and_words(self):
        text = build_session_catalog("en-IN").describe_for_prompt()
        assert '- um_hesitant [hesitation] "Um…"' in text


# ---------------------------------------------------------------------------
# Validation + TurnDelivery
# ---------------------------------------------------------------------------


class TestValidateDelivery:
    def test_unknown_ids_are_dropped(self):
        catalog = build_session_catalog("en-IN")
        plan = validate_delivery(
            ProposedDelivery(
                opener_kind="hesitation", opener_ids=["made_up", "um_hesitant"]
            ),
            catalog,
            source="working_memory",
        )
        assert plan.opener_ids == ("um_hesitant",)

    def test_an_interim_piece_that_answers_is_skipped(self):
        catalog = build_session_catalog("en-IN")
        for bad in ("Why do you ask?", "I take 20 mg a day.", "word " * 12):
            plan = validate_delivery(
                ProposedDelivery(interim=["It's just that…", bad, "I don't know…"]),
                catalog,
                source="working_memory",
            )
            # Skipped, not the end: ending at the first failure threw away
            # almost every interim in prod V2V.
            assert plan.interim == ("It's just that…", "I don't know…"), bad
        ok = validate_delivery(
            ProposedDelivery(interim=["It's just that…", "I don't know…", "it's hard"]),
            catalog,
            source="working_memory",
        )
        assert ok.interim == ("It's just that…", "I don't know…", "it's hard")

    def test_a_repeated_opening_is_dropped_and_the_rest_kept(self):
        plan = validate_delivery(
            ProposedDelivery(
                interim=["It's just that…", "I keep going back", "and forth"]
            ),
            None,
            source="working_memory",
            recent_lines=["It's just that… I don't know."],
        )
        assert plan.interim == ("I keep going back", "and forth")

    def test_a_finished_sentence_is_not_a_holding_piece(self):
        plan = validate_delivery(
            ProposedDelivery(
                interim=[
                    "सोच रहा हूँ कि...",
                    "रोहन के लिए ये अच्छे रहेंगे।",
                    "कैसे बताऊँ…",
                ]
            ),
            None,
            source="working_memory",
        )
        assert plan.interim == ("सोच रहा हूँ कि...", "कैसे बताऊँ…")
        plan = validate_delivery(
            ProposedDelivery(interim=["It's settled then.", "hard to say"]),
            None,
            source="working_memory",
        )
        assert [p.lower() for p in plan.interim] == ["hard to say"]

    def test_a_piece_with_a_name_is_dropped(self):
        plan = validate_delivery(
            ProposedDelivery(
                interim=["Just thinking about Vivaan…", "I'm not sure…", "hard to say"]
            ),
            None,
            source="working_memory",
        )
        assert plan.interim == ("I'm not sure…", "hard to say")

    def test_at_most_three_pieces(self):
        plan = validate_delivery(
            ProposedDelivery(interim=["one two", "three four", "five six", "seven"]),
            None,
            source="working_memory",
        )
        assert len(plan.interim) == 3

    def test_the_opening_piece_loses_a_hesitation_and_a_claim(self):
        """It usually follows a filler, so "Um," would be a second hesitation;
        and "I see…" before a pushback contradicts the reply (prod)."""
        plan = validate_delivery(
            ProposedDelivery(interim=["Um, it's just that…", "I don't know…"]),
            None,
            source="working_memory",
        )
        assert plan.interim[0].lower().startswith("it's just")
        plan = validate_delivery(
            ProposedDelivery(interim=["I see…", "it's just a lot…"]),
            None,
            source="working_memory",
        )
        assert [p.lower() for p in plan.interim] == ["it's just a lot…"]

    def test_a_missing_or_single_string_interim_is_tolerated(self):
        assert ProposedDelivery().interim == []
        assert ProposedDelivery(interim="It's just…").interim == ["It's just…"]

    def test_an_unknown_kind_falls_back_to_the_first_id(self):
        catalog = build_session_catalog("en-IN")
        plan = validate_delivery(
            ProposedDelivery(opener_kind="grunt", opener_ids=["hmm_reflective"]),
            catalog,
            source="planner",
        )
        assert plan.opener_kind == "reflective"

    def test_an_unplayable_kind_maps_to_the_nearest_playable_one(self):
        """No sigh audio ships yet; a "sigh" plan must still produce a sound."""
        catalog = build_session_catalog("en-IN")  # no assets -> no sigh entry
        plan = validate_delivery(
            ProposedDelivery(opener_kind="sigh"), catalog, source="working_memory"
        )
        assert plan.opener_kind == "reflective"
        plan = validate_delivery(
            ProposedDelivery(opener_kind="breath", opener_ids=["um_hesitant"]),
            catalog,
            source="working_memory",
        )
        assert plan.opener_kind == "hesitation"

    def test_a_piece_that_replays_a_recent_line_is_dropped(self):
        catalog = build_session_catalog("en-IN")
        recent = ["I'm trying to hold it together. It's a lot right now."]
        plan = validate_delivery(
            ProposedDelivery(interim=["I'm trying to hold it together."]),
            catalog,
            source="working_memory",
            recent_lines=recent,
        )
        assert plan.interim == ()
        fresh = validate_delivery(
            ProposedDelivery(interim=["Give me a second with that…"]),
            catalog,
            source="working_memory",
            recent_lines=recent,
        )
        assert fresh.interim == ("Give me a second with that…",)

    def test_a_fresh_indic_line_is_not_mistaken_for_a_repeat(self):
        """Hindi v2v: every holding line was dropped as a "repeat" because shared
        function words (and a tokenizer that split at vowel signs) made any
        two Hindi lines overlap."""
        recent = [
            "मुझे लगता है कि मैं बहुत थक गई हूँ। काम में समय ही नहीं मिलता।",
            "यह सब बहुत भारी लगता है।",
        ]
        for line in ("सोचने में समय लगता है...", "यह बहुत दबाव डालता है।"):
            assert not repeats_recent_line(line, recent), line
        # A genuine replay is still caught, in either script.
        assert repeats_recent_line("यह सब बहुत भारी लगता है", recent)
        assert repeats_recent_line(
            "trying to hold it together", ["I'm trying to hold it together."]
        )

    def test_silence_implies_a_hold(self):
        plan = validate_delivery(
            ProposedDelivery(opener_kind="silence"), None, source="planner"
        )
        assert plan.hold_silence is True

    def test_none_proposal_keeps_the_previous_plan(self):
        td = TurnDelivery()
        td.set_plan(validate_delivery(None, None, source="planner"))
        assert td.plan is DEFAULT_PLAN


class TestReplyNote:
    def test_no_note_without_a_sound(self):
        td = TurnDelivery()
        assert td.reply_note() is None
        td.note_opener(OpenerRecord(category="none"))
        assert td.reply_note() is None

    def test_note_never_quotes_the_sound(self):
        """Quoting it made the model echo it: "I mean…" -> "I mean, I try…"."""
        td = TurnDelivery()
        td.note_opener(OpenerRecord(category="vocal", spoken="Um…", kind="hesitation"))
        note = td.reply_note()
        assert "Um" not in note
        assert "no opening hesitation" in note and "do not repeat" in note

    def test_the_interim_is_quoted_so_the_reply_carries_on(self):
        """A reply that never learned the interim's words started a fresh
        thought after "It's just that…" — the disconnect learners reported."""
        td = TurnDelivery()
        td.note_opener(
            OpenerRecord(
                category="body",
                kind="breath",
                interim=("It's just that…", "I don't know…"),
            )
        )
        note = td.reply_note()
        assert "a breath" in note
        assert '"It\'s just that…"' in note and '"I don\'t know…"' in note
        assert "continues straight on" in note and "do not repeat" in note

    def test_an_interim_alone_is_quoted_without_a_sound(self):
        td = TurnDelivery()
        td.note_opener(OpenerRecord(category="none", interim=("It's hard…",)))
        note = td.reply_note()
        assert '"It\'s hard…"' in note and "make" not in note

    def test_turn_boundaries_clear_the_opener(self):
        td = TurnDelivery()
        td.note_opener(OpenerRecord(category="vocal", spoken="Hmm."))
        td.begin_turn()
        assert td.reply_note() is None

    def test_plan_listeners_see_every_plan_and_cannot_drop_it(self):
        td = TurnDelivery()
        seen = []
        td.on_plan(lambda plan: (_ for _ in ()).throw(RuntimeError("boom")))
        td.on_plan(seen.append)
        plan = DeliveryPlan(opener_kind="reflective", source="working_memory")
        td.set_plan(plan)
        assert td.plan is plan and seen == [plan]


# ---------------------------------------------------------------------------
# Turn-time rubric
# ---------------------------------------------------------------------------


class TestOpenerPolicy:
    def _policy(self, seed=0, **cfg):
        return OpenerPolicy(PolicyConfig(**cfg), rng=random.Random(seed))

    def test_unfinished_and_farewell_detection(self):
        assert learner_seems_unfinished("I was going to say that and")
        assert learner_seems_unfinished("मुझे लगता है कि")
        assert learner_seems_unfinished("so I tried,")
        assert not learner_seems_unfinished("I think so.")
        assert learner_is_leaving("Okay, bye!")
        assert learner_is_leaving("धन्यवाद")
        assert not learner_is_leaving("I want to talk about my job.")

    def test_nothing_over_an_unfinished_learner(self):
        catalog = build_session_catalog("en-IN")
        decision = self._policy().decide(
            DEFAULT_PLAN, catalog, _durations(catalog), 3000.0, "because I was and"
        )
        assert not decision.plays_anything
        assert decision.reason == "skipped_learner_unfinished"

    def test_nothing_before_a_goodbye(self):
        catalog = build_session_catalog("en-IN")
        decision = self._policy().decide(
            DEFAULT_PLAN, catalog, _durations(catalog), 3000.0, "Thanks, bye."
        )
        assert decision.reason == "skipped_closing"

    def test_nothing_on_a_fast_turn(self):
        catalog = build_session_catalog("en-IN")
        decision = self._policy().decide(
            DEFAULT_PLAN, catalog, _durations(catalog), 400.0, "Hello."
        )
        assert decision.reason == "skipped_fast_turn"

    def _run(self, policy, plan, catalog, turns=200, gap=2500.0, piece_ms=()):
        decisions = []
        for _ in range(turns):
            decision = policy.decide(
                plan, catalog, _durations(catalog), gap, "I see.", piece_ms
            )
            policy.record(decision)
            decisions.append(decision)
        return decisions

    @staticmethod
    def _wm(**kw):
        return DeliveryPlan(source="working_memory", **kw)

    def test_the_cover_grows_with_the_wait(self):
        """Short wait: nothing. Medium: a filler. Long (v3, 6-8 s): a filler and
        the interim pieces."""
        catalog = build_session_catalog("en-IN")
        plan = self._wm(
            opener_kind="hum", interim=("It's just that…", "I don't know…", "it's hard")
        )
        pieces = (900.0, 800.0, 700.0)
        cfg = dict(hold_min_ms=400.0, hold_max_ms=400.0)
        fast = self._policy(**cfg).decide(
            plan, catalog, _durations(catalog), 500.0, "I see.", pieces
        )
        assert not fast.plays_anything
        medium = self._policy(**cfg).decide(
            plan, catalog, _durations(catalog), 1800.0, "I see.", pieces
        )
        # A sound OR a line: both won't fit, so the line goes alone.
        assert medium.entry is None and medium.pieces == 1
        long_ = self._policy(**cfg).decide(
            plan, catalog, _durations(catalog), 7000.0, "I see.", pieces
        )
        assert long_.entry is not None and long_.pieces == 3

    def test_the_gaps_lengthen_and_a_beat_is_left_before_the_reply(self):
        catalog = build_session_catalog("en-IN")
        plan = self._wm(opener_kind="hum", interim=("a b", "c d", "e f"))
        cfg = dict(hold_min_ms=400.0, hold_max_ms=400.0, tail_ms=500.0)
        d = self._policy(**cfg).decide(
            plan, catalog, _durations(catalog), 8000.0, "I see.", (600.0, 600.0, 600.0)
        )
        assert d.pieces == 3
        assert list(d.gaps_ms) == sorted(d.gaps_ms) and d.gaps_ms[0] < d.gaps_ms[-1]
        assert d.gaps_ms[1] == pytest.approx(d.gaps_ms[0] * 1.4)
        end = d.hold_ms + 600.0 + sum(d.gaps_ms) + 3 * 600.0
        assert end <= 8000.0 - 500.0

    def test_a_filler_plays_when_no_line_fits_even_alone(self):
        catalog = build_session_catalog("en-IN")
        plan = self._wm(opener_kind="hum", interim=("a b",))
        d = self._policy(hold_min_ms=400.0, hold_max_ms=400.0).decide(
            plan, catalog, _durations(catalog), 1500.0, "I see.", (2000.0,)
        )
        assert d.entry is not None and d.pieces == 0

    def test_a_piece_that_does_not_fit_is_left_out(self):
        catalog = build_session_catalog("en-IN")
        plan = self._wm(opener_kind="hum", interim=("a b", "c d"))
        cfg = dict(hold_min_ms=400.0, hold_max_ms=400.0)
        # 400 hold + 600 filler + 350 gap + 900 piece = 2250 > 3000 - 500? No:
        # fits. The second (gap 490 + 900) does not.
        d = self._policy(**cfg).decide(
            plan, catalog, _durations(catalog), 3000.0, "I see.", (900.0, 900.0)
        )
        assert d.entry is not None and d.pieces == 1

    def test_speech_never_fills_the_whole_wait(self):
        catalog = build_session_catalog("en-IN")
        plan = self._wm(opener_kind="hum", interim=("a b", "c d", "e f"))
        d = self._policy(max_speech_share=0.5).decide(
            plan, catalog, _durations(catalog), 6000.0, "I see.", (1200.0,) * 3
        )
        assert 600.0 + d.pieces * 1200.0 <= 0.5 * 6000.0

    def test_with_no_filler_the_interim_opens_after_the_pause(self):
        plan = self._wm(opener_kind="hum", interim=("It's hard…",))
        d = self._policy().decide(plan, None, {}, 4000.0, "I see.", (900.0,))
        assert d.entry is None and d.pieces == 1 and d.gaps_ms == (0.0,)

    def test_the_plan_s_own_filler_plays(self):
        """The old rules replaced working memory's kind on ~60% of prod turns."""
        catalog = build_session_catalog("en-IN")
        plan = self._wm(opener_kind="hesitation", opener_ids=("um_hesitant",))
        firsts = [
            self._policy(seed=seed).decide(
                plan, catalog, _durations(catalog), 2500.0, "I see."
            )
            for seed in range(50)
        ]
        assert all(d.entry is not None and d.entry.id == "um_hesitant" for d in firsts)

    def test_variety_comes_from_the_plan_s_own_list(self):
        """Its first choice in the no-repeat window: the next suggestion plays,
        and it stays the planned kind."""
        catalog = build_session_catalog("en-IN")
        ids = catalog.ids_of_kind("hesitation")
        assert len(ids) >= 2
        plan = self._wm(opener_kind="hesitation", opener_ids=tuple(ids[:3]))
        decisions = self._run(self._policy(seed=3), plan, catalog, turns=40)
        played = [d.entry for d in decisions if d.entry is not None]
        assert played and all(e.kind == "hesitation" for e in played)
        assert len({e.id for e in played}) >= 2

    def test_a_pause_plan_is_a_real_pause(self):
        """Prod: a "silence" plan still played a sound 16 of 16 times."""
        catalog = build_session_catalog("en-IN")
        plan = self._wm(opener_kind="silence", hold_silence=True)
        d = self._policy(seed=1).decide(
            plan, catalog, _durations(catalog), 1800.0, "I see."
        )
        assert not d.plays_anything
        # A wait that outlasts the pause gets a sound after it, never at once.
        long_ = self._policy(seed=1).decide(
            plan, catalog, _durations(catalog), 4500.0, "I see."
        )
        assert long_.entry is not None and long_.hold_ms >= 1200.0

    def test_breath_and_sigh_are_spaced_out(self):
        """Prod: a planner asking "sigh" every turn gave a breath or sigh on 4
        of 9 turns. At most one body sound per body_min_gap_turns."""
        catalog = build_session_catalog("en-IN", gender="female")
        plan = self._wm(opener_kind="breath", opener_ids=("breath_in",))
        decisions = self._run(
            self._policy(seed=3, body_min_gap_turns=4), plan, catalog, gap=3500.0
        )
        body_turns = [i for i, d in enumerate(decisions) if d.category == "body"]
        assert body_turns, "body openers must still play sometimes"
        assert all(b - a >= 4 for a, b in zip(body_turns, body_turns[1:]))
        # The blocked turns still get a sound, not silence.
        assert sum(d.plays_anything for d in decisions) / len(decisions) > 0.9

    def test_no_family_repeats_inside_the_window(self):
        catalog = build_session_catalog("en-IN")
        decisions = self._run(self._policy(repeat_window=4), DEFAULT_PLAN, catalog)
        families = [d.entry.family for d in decisions if d.entry is not None]
        for i in range(1, len(families)):
            assert families[i] not in families[max(0, i - 4) : i]

    def test_without_working_memory_fillers_rotate_and_pauses_happen(self):
        catalog = build_session_catalog("en-IN")
        decisions = self._run(self._policy(seed=2), DEFAULT_PLAN, catalog, gap=1800.0)
        kinds = [d.entry.kind for d in decisions if d.entry is not None]
        assert len(set(kinds)) >= 3
        assert not any(a == b for a, b in zip(kinds, kinds[1:]))
        silent = sum(1 for d in decisions if not d.plays_anything)
        assert 0.15 < silent / len(decisions) < 0.6
        # A long wait is not left to a pause alone.
        long_ = self._run(self._policy(seed=2), DEFAULT_PLAN, catalog, gap=4500.0)
        assert all(d.plays_anything for d in long_)
        assert all(d.pieces == 0 for d in long_)  # no plan, no interim

    def test_a_filler_too_long_for_the_wait_is_not_played(self):
        catalog = build_session_catalog("en-IN")
        durations = {k: 2500.0 for k in catalog.entries}  # all too long
        decision = self._policy().decide(
            DEFAULT_PLAN, catalog, durations, 2000.0, "I see."
        )
        assert decision.entry is None


# ---------------------------------------------------------------------------
# Reply shaping
# ---------------------------------------------------------------------------


def _stream(stage, chunks):
    out = "".join(stage.feed(c) for c in chunks)
    return out + stage.flush()


class TestLeadingHesitationTrimmer:
    def test_trims_leading_hesitation_and_pause_tags(self):
        chunks = ["[long ", "pause] Um", ", well, ", "yeah I see the difference."]
        out = _stream(LeadingHesitationTrimmer(active=True), chunks)
        assert out == "Yeah I see the difference."

    def test_keeps_meaningful_openings(self):
        for text in ("Right, I'll try that.", "Wellbeing matters.", "[sad] I lost it."):
            assert _stream(LeadingHesitationTrimmer(active=True), [text]) == text

    def test_devanagari(self):
        out = _stream(LeadingHesitationTrimmer(active=True), ["अं… ", "मुझे नहीं पता।"])
        assert out == "मुझे नहीं पता।"

    def test_inactive_is_a_pass_through(self):
        assert _stream(LeadingHesitationTrimmer(active=False), ["Um, ok"]) == "Um, ok"

    def test_strips_a_restated_interim_piece(self):
        """Prod V2V: "I just feel…" then the reply "I just feel like I want…"."""
        trimmer = LeadingHesitationTrimmer(
            is_active=lambda: True, phrases=lambda: ["Um…", "I just feel…"]
        )
        out = _stream(trimmer, ["I just ", "feel like I want ", "him to be happy."])
        assert out == "Like I want him to be happy."

    def test_a_quoted_reply_is_still_recognised(self):
        """Some scenarios wrap every reply in quotes (prod V2V, 2026-10-16)."""
        trimmer = LeadingHesitationTrimmer(
            is_active=lambda: True, phrases=lambda: ["Just thinking…"]
        )
        out = _stream(trimmer, ['"Just ', "thinking… I think ", "it might help."])
        assert out == "I think it might help."

    def test_strips_the_echoed_opener_phrase(self):
        """The first live run: every opener came back at the start of the reply."""
        cases = [
            (
                "I mean…",
                ["I mean, I try a few ", "deep breaths."],
                "I try a few deep breaths.",
            ),
            (
                "Hmm…",
                ["Hmm… it defin", "itely takes a toll."],
                "It definitely takes a toll.",
            ),
            ("Uh…", ["Uh…"], ""),
            ("मतलब…", ["मतलब, मैं ", "कोशिश करती हूँ।"], "मैं कोशिश करती हूँ।"),
        ]
        for opener, chunks, expected in cases:
            trimmer = LeadingHesitationTrimmer(
                is_active=lambda: True, phrases=lambda o=opener: [o]
            )
            assert _stream(trimmer, chunks) == expected, opener

    def test_a_partial_phrase_match_is_released(self):
        trimmer = LeadingHesitationTrimmer(
            is_active=lambda: True, phrases=lambda: ["I mean…"]
        )
        assert _stream(trimmer, ["I ", "need a break."]) == "I need a break."

    def test_activation_is_decided_at_the_first_token(self):
        """llm_node can open before the opener is decided; the trim still sees it."""
        state = {"on": False}
        trimmer = LeadingHesitationTrimmer(
            is_active=lambda: state["on"], phrases=lambda: ["Hmm…"]
        )
        state["on"] = True  # decided after construction, before the first token
        assert _stream(trimmer, ["Hmm… okay then."]) == "Okay then."
        off = LeadingHesitationTrimmer(is_active=lambda: False, phrases=lambda: [])
        assert _stream(off, ["Hmm… okay."]) == "Hmm… okay."

    def test_a_reply_that_is_only_hesitation_ends_empty(self):
        assert _stream(LeadingHesitationTrimmer(active=True), ["Hmm..."]) == ""


class TestAudioTagLimiter:
    def test_keeps_the_first_tag_only(self):
        chunks = ["[sighs] I don't ", "know [pa", "use] maybe [long pause] later."]
        out = _stream(AudioTagLimiter(1), chunks)
        assert out == "[sighs] I don't know  maybe  later."

    def test_unclosed_bracket_is_text(self):
        assert _stream(AudioTagLimiter(1), ["a [b c"]) == "a [b c"

    def test_disabled(self):
        assert _stream(AudioTagLimiter(None), ["[a] [b]"]) == "[a] [b]"


# ---------------------------------------------------------------------------
# Playback
# ---------------------------------------------------------------------------


class _Handle:
    def __init__(self):
        self.stopped = False

    def done(self):
        return self.stopped

    def stop(self):
        self.stopped = True


class _BG:
    def __init__(self):
        self.played = []
        self.flushed = 0

    def play(self, config):
        handle = _Handle()
        self.played.append(handle)
        return handle

    def flush(self):
        self.flushed += 1


def _player(monkeypatch, *, policy_cfg=None, plan=None):
    from app.core.livekit.opener_player import OpenerPlayer

    catalog = build_session_catalog("en-IN")
    td = TurnDelivery(catalog)
    if plan is not None:
        td.set_plan(plan)
    bg = _BG()
    transcripts = []

    async def _synth(phrases, source):
        return [FillerClip(phrase=p[0], frames=[], duration_ms=300.0) for p in phrases]

    cfg = policy_cfg or PolicyConfig(
        hold_min_ms=1.0, hold_max_ms=2.0, piece_gap_ms=10.0, tail_ms=1.0
    )
    player = OpenerPlayer(
        room_name="room-x",
        turn_delivery=td,
        policy=OpenerPolicy(cfg, rng=random.Random(0)),
        bg_audio_getter=lambda: bg,
        predicted_gap_ms=lambda: 4000.0,
        synthesize=_synth,
        emit_filler_transcript=lambda text, ts: transcripts.append(("filler", text)),
        emit_interim_transcript=lambda text, ts: transcripts.append(("interim", text)),
    )
    monkeypatch.setattr(
        "livekit.agents.AudioConfig", lambda *a, **k: types.SimpleNamespace()
    )
    return player, td, bg, transcripts


class TestOpenerPlayer:
    @pytest.mark.asyncio
    async def test_plays_one_opener_and_tells_the_reply(self, monkeypatch):
        player, td, bg, transcripts = _player(monkeypatch)
        assert await player.render_catalog() > 0
        player.on_agent_state("thinking")
        # Recorded BEFORE the hold, so the reply prompt can already see it.
        assert td.opener is not None and td.opener.made_a_sound
        await asyncio.sleep(0.4)
        assert len(bg.played) == 1
        assert transcripts and transcripts[0][0] == "filler"
        assert "no opening hesitation" in td.reply_note()

    @pytest.mark.asyncio
    async def test_learner_speech_cancels_and_flushes(self, monkeypatch):
        player, td, bg, _ = _player(monkeypatch)
        await player.render_catalog()
        recorded = {"metadata": {}}
        monkeypatch.setattr(
            turn_metrics,
            "record",
            lambda room, metadata=None, **kw: recorded["metadata"].update(
                metadata or {}
            ),
        )
        player.on_agent_state("thinking")
        await asyncio.sleep(0.01)
        player.on_user_state("speaking")
        await asyncio.sleep(0.05)
        assert player.stats["cancelled_by_learner"] == 1
        assert recorded["metadata"]["openerCancelledByLearner"] is True
        assert all(h.stopped for h in bg.played)

    @pytest.mark.asyncio
    async def test_one_opener_per_reply_cycle(self, monkeypatch):
        """A false endpoint must not stack a second opener before one reply."""
        player, td, bg, _ = _player(monkeypatch)
        await player.render_catalog()
        player.on_agent_state("thinking")
        await asyncio.sleep(0.3)
        assert len(bg.played) == 1
        # The learner resumes (back to listening), then pauses again.
        player.on_agent_state("listening")
        player.on_agent_state("thinking")
        await asyncio.sleep(0.3)
        assert len(bg.played) == 1
        # Once a real reply has started, the next turn may open again.
        player.on_agent_state("speaking")
        player.on_agent_state("listening")
        player.on_agent_state("thinking")
        await asyncio.sleep(0.3)
        assert len(bg.played) == 2

    @pytest.mark.asyncio
    async def test_a_false_endpoint_keeps_what_was_heard_on_record(self, monkeypatch):
        """Kannada prod session: the learner paused, heard the interim, went
        on — and the reply restated it, because the record had been wiped."""
        player, td, bg, _ = _player(monkeypatch)
        await player.render_catalog()
        player.on_agent_state("thinking")
        await asyncio.sleep(0.3)
        assert td.opener is not None and td.opener.made_a_sound
        player.on_agent_state("listening")  # the learner goes on
        player.on_agent_state("thinking")  # and pauses again
        assert td.opener is not None and td.opener.made_a_sound
        assert td.reply_note() is not None
        # After the real reply, the next turn starts clean.
        player.on_agent_state("speaking")
        player.on_agent_state("listening")
        assert td.opener is None

    @pytest.mark.asyncio
    async def test_an_opener_withdrawn_in_its_hold_does_not_block_the_turn(
        self, monkeypatch
    ):
        """Nothing was heard, so the learner's next pause may still get one."""
        cfg = PolicyConfig(hold_min_ms=150.0, hold_max_ms=160.0)
        player, td, bg, _ = _player(monkeypatch, policy_cfg=cfg)
        await player.render_catalog()
        decisions = []
        monkeypatch.setattr(
            turn_metrics,
            "note_filler_decision",
            lambda room, decision, **kw: decisions.append(decision),
        )
        player.on_agent_state("thinking")
        await asyncio.sleep(0.02)
        player.on_user_state("speaking")  # during the hold
        player.on_agent_state("listening")
        player.on_user_state("listening")
        assert "cancelled_before_play" in decisions
        assert bg.played == []
        player.on_agent_state("thinking")
        await asyncio.sleep(0.4)
        assert len(bg.played) == 1
        assert "skipped_same_reply" not in decisions

    @pytest.mark.asyncio
    async def test_reply_taking_over_cuts_the_opener(self, monkeypatch):
        player, td, bg, _ = _player(monkeypatch)
        await player.render_catalog()
        player.on_agent_state("thinking")
        await asyncio.sleep(0.05)
        player.on_agent_state("speaking")
        assert all(h.stopped for h in bg.played)
        player.on_agent_state("listening")
        assert td.opener is None

    @staticmethod
    def _capture(monkeypatch):
        meta = {}

        def _merge(room, metadata=None, **kw):
            meta.update(metadata or {})

        def _decision(room, decision, **kw):
            meta.update(kw)

        def _started(room, ts, kind="filler", interim_source=None):
            meta.setdefault("firstKind", kind)
            if interim_source:
                meta.setdefault("interimSource", interim_source)

        monkeypatch.setattr(turn_metrics, "record", _merge)
        monkeypatch.setattr(turn_metrics, "note_filler_decision", _decision)
        monkeypatch.setattr(turn_metrics, "note_filler_started", _started)
        return meta

    @pytest.mark.asyncio
    async def test_the_interim_plays_piece_by_piece_after_the_filler(self, monkeypatch):
        player, td, bg, transcripts = _player(monkeypatch)
        meta = self._capture(monkeypatch)
        await player.render_catalog()
        td.on_plan(player.on_plan)
        td.set_plan(
            DeliveryPlan(
                opener_kind="hum",
                interim=("It's just that…", "I don't know…"),
                source="working_memory",
            )
        )
        await asyncio.sleep(0.01)
        player.on_agent_state("thinking")
        assert td.opener.interim == ("It's just that…", "I don't know…")
        assert '"I don\'t know…"' in td.reply_note()
        await asyncio.sleep(1.5)
        assert len(bg.played) == 3  # filler, then two pieces
        # One transcript line for the whole interim, not one per piece.
        assert ("interim", "It's just that… I don't know…") in transcripts
        assert meta["openerBridge"] is True  # an interim followed the filler
        assert meta["cuesPlayed"] == 3 and meta["interimPiecesPlayed"] == 2
        assert meta["interimPiecesScheduled"] == 2

    @pytest.mark.asyncio
    async def test_the_reply_cuts_the_interim_and_only_what_was_heard_is_kept(
        self, monkeypatch
    ):
        player, td, bg, transcripts = _player(monkeypatch)
        self._capture(monkeypatch)
        await player.render_catalog()
        td.on_plan(player.on_plan)
        td.set_plan(
            DeliveryPlan(
                opener_kind="hum",
                interim=("It's just that…", "I don't know…", "it's hard"),
                source="working_memory",
            )
        )
        await asyncio.sleep(0.01)
        player.on_agent_state("thinking")
        await asyncio.sleep(0.45)  # filler done, first piece playing
        player.on_agent_state("speaking")
        await asyncio.sleep(0.05)
        assert len(bg.played) == 2 and bg.played[-1].stopped and bg.flushed
        assert ("interim", "It's just that…") in transcripts

    @pytest.mark.asyncio
    async def test_without_working_memory_the_generator_s_line_plays(self, monkeypatch):
        player, td, bg, transcripts = _player(monkeypatch)
        self._capture(monkeypatch)
        await player.render_catalog()
        line = FillerClip(phrase="It's hard to say…", frames=[], duration_ms=300.0)
        player.set_live_interim(line.phrase, line)
        player.on_agent_state("thinking")
        assert td.opener.interim == ("It's hard to say…",)
        await asyncio.sleep(1.0)
        assert len(bg.played) == 2
        assert ("interim", "It's hard to say…") in transcripts
        # Heard once: the next turn does not replay it.
        player.on_agent_state("speaking")
        player.on_agent_state("listening")
        player.on_agent_state("thinking")
        await asyncio.sleep(1.0)
        assert len(bg.played) == 3

    @pytest.mark.asyncio
    async def test_the_real_wait_is_reported_from_the_last_thinking(self, monkeypatch):
        player, td, bg, _ = _player(monkeypatch)
        seen = []
        player._observe_wait = seen.append
        player.on_agent_state("thinking", created_at=100.0)
        player.on_agent_state("listening", created_at=100.4)  # false endpoint
        player.on_agent_state("thinking", created_at=101.0)
        player.on_agent_state("speaking", created_at=103.9)
        assert seen == [pytest.approx(2900.0)]
        # The opening statement has no thinking before it: nothing reported.
        player.on_agent_state("listening", created_at=110.0)
        player.on_agent_state("speaking", created_at=111.0)
        assert len(seen) == 1

    @pytest.mark.asyncio
    async def test_a_line_ready_during_the_filler_still_plays_if_it_fits(
        self, monkeypatch
    ):
        """Rendering can finish after the learner stops (v3 takes ~3-4 s)."""
        player, td, bg, transcripts = _player(monkeypatch)
        meta = self._capture(monkeypatch)
        await player.render_catalog()
        player.on_agent_state("thinking", created_at=__import__("time").time())
        await asyncio.sleep(0.1)  # the filler is playing
        line = FillerClip(phrase="It's hard to say…", frames=[], duration_ms=300.0)
        player.set_live_interim(line.phrase, line)
        await asyncio.sleep(1.0)
        assert len(bg.played) == 2
        assert ("interim", "It's hard to say…") in transcripts
        assert meta.get("interimSource") is None  # the filler was first

    @pytest.mark.asyncio
    async def test_a_plan_s_pieces_are_never_mixed_with_an_older_render(
        self, monkeypatch
    ):
        player, td, bg, transcripts = _player(monkeypatch)
        self._capture(monkeypatch)
        await player.render_catalog()
        td.on_plan(player.on_plan)
        td.set_plan(DeliveryPlan(interim=("Old words…",), source="working_memory"))
        await asyncio.sleep(0.01)
        # A new plan arrives and its render has not finished.
        player._synthesize = lambda *a, **k: asyncio.sleep(10, result=[])
        td.set_plan(DeliveryPlan(interim=("New words…",), source="working_memory"))
        player.on_agent_state("thinking")
        await asyncio.sleep(0.8)
        assert not any(t == ("interim", "Old words…") for t in transcripts)


class TestClipLessVoice:
    """A voice the clip policy refuses (Gemini-TTS, Hume): no spoken clip may
    render (a second voice), so only the bundled breath and sigh recordings
    are playable."""

    @pytest.mark.asyncio
    async def test_only_body_openers_play_and_no_interim_renders(self, monkeypatch):
        from app.core.livekit.opener_player import OpenerPlayer

        catalog = build_session_catalog("en-IN", gender="female")
        catalog.entries = {k: e for k, e in catalog.entries.items() if e.is_asset}
        assert catalog.entries, "breath/sigh assets must ship for this path"
        td = TurnDelivery(catalog)
        bg = _BG()
        synth_calls = []

        async def _synth(phrases, source):
            synth_calls.append(source)
            return []

        player = OpenerPlayer(
            room_name="room-v3",
            turn_delivery=td,
            policy=OpenerPolicy(
                PolicyConfig(hold_min_ms=1.0, hold_max_ms=2.0),
                rng=random.Random(0),
            ),
            bg_audio_getter=lambda: bg,
            predicted_gap_ms=lambda: 5000.0,
            synthesize=_synth,
            emit_filler_transcript=lambda text, ts: None,
            emit_interim_transcript=lambda text, ts: None,
        )
        monkeypatch.setattr(
            "livekit.agents.AudioConfig", lambda *a, **k: types.SimpleNamespace()
        )
        assert await player.render_catalog() == len(catalog.entries)
        assert synth_calls == []  # nothing spoken was even attempted
        td.on_plan(player.on_plan)
        td.set_plan(
            DeliveryPlan(
                opener_kind="breath", interim=("Okay…",), source="working_memory"
            )
        )
        await asyncio.sleep(0.01)
        player.on_agent_state("thinking")
        await asyncio.sleep(1.5)
        assert len(bg.played) == 1  # the body opener; no interim clip exists
        assert td.opener.category == "body"
        assert td.opener.interim == ()


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


class TestClipSynthesisConcurrency:
    @pytest.mark.asyncio
    async def test_renders_are_bounded(self, monkeypatch):
        """24 entries at once drew ElevenLabs 429 bursts in prod."""
        from app.core.livekit import filler_clips

        monkeypatch.setattr(filler_clips, "_synthesis_concurrency", lambda: 3)
        state = {"now": 0, "peak": 0}

        async def _render(tts, phrase, variant):
            state["now"] += 1
            state["peak"] = max(state["peak"], state["now"])
            await asyncio.sleep(0.01)
            state["now"] -= 1
            return [object()], 100.0

        monkeypatch.setattr(filler_clips, "_render_one", _render)
        client = types.SimpleNamespace(create_clip_tts=lambda: object())
        clips = await filler_clips.synthesize_clips(
            client, [f"phrase {i}" for i in range(24)], use_cache=False
        )
        assert len(clips) == 24
        assert state["peak"] == 3


class TestPostFillerSilence:
    def test_finalize_reports_the_silence_after_the_opener(self):
        room = "room-silence"
        turn_metrics.discard(room)
        turn_metrics.note_user_speech_end(room, 100.0)
        turn_metrics.note_filler_started(room, 100.6)
        turn_metrics.note_filler_ended(room, 101.4)
        out = turn_metrics.finalize(room, 103.0)
        assert out["metadata"]["postFillerSilenceMs"] == 1600
        assert out["metadata"]["firstAudioSource"] == "filler"

    def test_played_replaces_an_earlier_skip_in_the_same_turn(self):
        """A false endpoint gives one turn two "thinking" states."""
        room = "room-override"
        turn_metrics.discard(room)
        turn_metrics.note_filler_decision(room, "skipped_policy")
        turn_metrics.note_filler_decision(room, "played", openerId="i_mean")
        turn_metrics.note_filler_decision(room, "skipped_policy")
        turn_metrics.note_user_speech_end(room, 1.0)
        out = turn_metrics.finalize(room, 2.0)
        assert out["metadata"]["fillerDecision"] == "played"

    def test_new_decisions_are_recorded(self):
        room = "room-decision"
        turn_metrics.discard(room)
        turn_metrics.note_filler_decision(room, "skipped_learner_unfinished")
        turn_metrics.note_user_speech_end(room, 1.0)
        out = turn_metrics.finalize(room, 2.0)
        assert out["metadata"]["fillerDecision"] == "skipped_learner_unfinished"


# ---------------------------------------------------------------------------
# Graph seams
# ---------------------------------------------------------------------------


class TestGraphSeams:
    def test_no_planner_runs_without_working_memory(self):
        """Those scenarios get fillers and pauses (plus the interim generator's
        line); a second planner prompt confused the people editing prompts."""
        from app.core.graph import graph_builder, nodes

        assert not hasattr(nodes, "plan_delivery")
        assert not hasattr(graph_builder, "build_plan_delivery_subgraph")

    def test_working_memory_hooks_validate_against_the_catalog(self):
        from app.core.graph.nodes import _delivery_hooks

        td = TurnDelivery(build_session_catalog("en-IN"))
        assert _delivery_hooks(td, "working_memory") == {}  # not active yet
        td.active = True
        hooks = _delivery_hooks(td, "working_memory")
        assert "um_hesitant" in hooks["opener_catalog"]
        hooks["on_delivery"](
            ProposedDelivery(
                opener_kind="hesitation", opener_ids=["nope", "um_hesitant"]
            ),
            7,
        )
        assert td.plan.source == "working_memory"
        assert td.plan.opener_ids == ("um_hesitant",)
        assert td.plan.made_after_turn == 7

    def test_reply_note_reaches_generate_response_helper(self):
        from app.core.graph.nodes import _delivery_reply_note

        td = TurnDelivery()
        td.note_opener(OpenerRecord(category="vocal", spoken="Hmm…"))
        note = _delivery_reply_note({"configurable": {"turn_delivery": td}})
        assert note and "thinking sound" in note
        assert _delivery_reply_note({"configurable": {}}) is None

    def test_history_gets_the_same_trim(self):
        from app.core.graph.nodes import _trim_after_opener

        td = TurnDelivery()
        assert _trim_after_opener(td, "Hmm… fine.") == "Hmm… fine."
        td.note_opener(OpenerRecord(category="vocal", spoken="Hmm…"))
        assert _trim_after_opener(td, "Hmm… fine.") == "Fine."
        # A reply that was ONLY the echo keeps its text in history.
        assert _trim_after_opener(td, "Hmm…") == "Hmm…"


class TestAgentStreamStages:
    @pytest.mark.asyncio
    async def test_trim_and_tag_cap_compose_with_the_swap(self, monkeypatch):
        from livekit.agents import Agent

        from app.core.agent.factory import GlossarySwapAgent

        td = TurnDelivery()
        agent = GlossarySwapAgent(
            instructions="",
            swap_table={},
            room_name="room-s",
            turn_delivery=td,
            audio_tag_cap=1,
        )

        async def _fake(self, chat_ctx, tools, model_settings):
            # The opener is decided AFTER llm_node opens, before the first token.
            td.note_opener(OpenerRecord(category="vocal", spoken="Um…"))
            for piece in ["[long pause] um, ", "[sad] I tried ", "[sighs] twice."]:
                yield piece

        monkeypatch.setattr(Agent.default, "llm_node", _fake)
        out = "".join([c async for c in agent.llm_node(None, [], None)])
        assert out == "[sad] I tried  twice."

    @pytest.mark.asyncio
    async def test_pass_through_without_an_opener_or_cap(self, monkeypatch):
        from livekit.agents import Agent

        from app.core.agent.factory import GlossarySwapAgent

        agent = GlossarySwapAgent(
            instructions="", swap_table={}, room_name="r", turn_delivery=TurnDelivery()
        )

        async def _fake(self, chat_ctx, tools, model_settings):
            yield "Um, [pause] hi."

        monkeypatch.setattr(Agent.default, "llm_node", _fake)
        out = "".join([c async for c in agent.llm_node(None, [], None)])
        assert out == "Um, [pause] hi."


class TestStripLeadingHesitation:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("Hhh, you know, it's just that...", "You know, it's just that..."),
            ("Um… I guess", "I guess"),
            ("[sighs] Okay so", "Okay so"),
            ("I mean it", "I mean it"),
            ("Hmm.", ""),
        ],
    )
    def test_strips_only_a_leading_hesitation(self, text, expected):
        from app.core.livekit.reply_shaping import strip_leading_hesitation

        assert strip_leading_hesitation(text) == expected


class TestStripUnderstandingClaim:
    """The interim is spoken before the reply exists; "I see…" in front of a
    refusal contradicts it. Prod v19 forbids these and the model still said
    "I see… it's just that…", "I get what you mean…" and "Okay, I see..."."""

    @pytest.mark.parametrize(
        "text,expected",
        [
            (
                "I see… it's just that I really don't know what to expect here,",
                "It's just that I really don't know what to expect here,",
            ),
            ("I get what you mean…", ""),
            ("Okay, I see...", ""),
            ("Oh, I see what you mean, it's just hard", "It's just hard"),
            ("I understand, but I keep worrying…", "But I keep worrying…"),
            ("That makes sense, it's just—", "It's just—"),
            ("समझ गई, बस…", ""),
            # Untouched: no claim of understanding at the start.
            ("I’m just thinking about…", "I’m just thinking about…"),
            ("Seeing him like this is hard", "Seeing him like this is hard"),
            ("Okay, it's just a lot", "Okay, it's just a lot"),
        ],
    )
    def test_strips_a_leading_claim(self, text, expected):
        from app.core.livekit.reply_shaping import strip_understanding_claim

        assert strip_understanding_claim(text) == expected
