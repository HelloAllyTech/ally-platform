"""The delivery plan: catalog, validation, turn-time rubric, playback, shaping.

Each class drives one layer through its public entry point. The rubric these
enforce (product, 2026-09-29): vary the first sound across turns, one opener at
most with a thinking pause after it, never the same sound twice running,
nothing over the learner, nothing before a goodbye, fit the character's state.
"""

from __future__ import annotations

import asyncio
import random
import types
import wave
from unittest.mock import Mock

import pytest

from app.core.livekit.delivery import (
    DEFAULT_PLAN,
    DeliveryPlan,
    OpenerRecord,
    ProposedDelivery,
    TurnDelivery,
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

    def test_asset_entries_need_the_file(self, tmp_path):
        assert (
            build_session_catalog("en-IN", asset_dir=tmp_path).get("breath_in") is None
        )
        with wave.open(str(tmp_path / "breath_in.wav"), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(b"\x00\x00" * 2400)
        entry = build_session_catalog("en-IN", asset_dir=tmp_path).get("breath_in")
        assert entry is not None and entry.is_asset

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

    def test_a_bridge_line_that_answers_is_refused(self):
        catalog = build_session_catalog("en-IN")
        for bad in ("Why do you ask?", "I take 20 mg a day.", "word " * 25):
            plan = validate_delivery(
                ProposedDelivery(bridge_line=bad), catalog, source="planner"
            )
            assert plan.bridge_line is None, bad
        ok = validate_delivery(
            ProposedDelivery(bridge_line="That's… a lot to think about."),
            catalog,
            source="planner",
        )
        assert ok.bridge_line == "That's… a lot to think about."

    def test_an_unknown_kind_falls_back_to_the_first_id(self):
        catalog = build_session_catalog("en-IN")
        plan = validate_delivery(
            ProposedDelivery(opener_kind="grunt", opener_ids=["hmm_reflective"]),
            catalog,
            source="planner",
        )
        assert plan.opener_kind == "reflective"

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

    def test_body_sound_and_bridge(self):
        td = TurnDelivery()
        td.note_opener(OpenerRecord(category="body", kind="sigh", bridge="It's hard."))
        note = td.reply_note()
        assert "a sigh" in note and "holding line" in note
        assert "It's hard." not in note

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
        plan = DeliveryPlan(opener_kind="reflective", source="planner")
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

    def _run(self, policy, plan, catalog, turns=200, gap=3200.0, bridge_ms=None):
        decisions = []
        for _ in range(turns):
            decision = policy.decide(
                plan, catalog, _durations(catalog), gap, "I see.", bridge_ms
            )
            policy.record(decision)
            decisions.append(decision)
        return decisions

    def test_not_every_turn_starts_with_a_sound(self):
        catalog = build_session_catalog("en-IN")
        decisions = self._run(self._policy(), DEFAULT_PLAN, catalog)
        with_sound = sum(1 for d in decisions if d.plays_anything)
        assert 0.3 < with_sound / len(decisions) < 0.8

    def test_vocal_runs_are_capped(self):
        catalog = build_session_catalog("en-IN")
        decisions = self._run(self._policy(max_vocal_run=2), DEFAULT_PLAN, catalog)
        run = longest = 0
        for d in decisions:
            run = run + 1 if d.category == "vocal" else 0
            longest = max(longest, run)
        assert longest <= 2

    def test_no_family_repeats_inside_the_window(self):
        catalog = build_session_catalog("en-IN")
        decisions = self._run(self._policy(repeat_window=4), DEFAULT_PLAN, catalog)
        families = [d.entry.family for d in decisions if d.entry is not None]
        for i in range(1, len(families)):
            assert families[i] not in families[max(0, i - 4) : i]

    def test_the_plan_decides_what_kind_plays(self):
        catalog = build_session_catalog("en-IN")
        plan = DeliveryPlan(opener_kind="hesitation", opener_ids=("um_hesitant",))
        decisions = self._run(self._policy(seed=3), plan, catalog, turns=60)
        kinds = [d.entry.kind for d in decisions if d.entry is not None]
        # The no-repeat window rotates through the kind's few families, so the
        # plan's kind cannot play every time, but it must lead by a clear margin.
        counts = {k: kinds.count(k) for k in set(kinds)}
        assert max(counts, key=counts.get) == "hesitation"
        assert counts["hesitation"] > len(kinds) / 3

    def test_a_pause_plan_holds_longer_and_speaks_less(self):
        catalog = build_session_catalog("en-IN")
        quiet = DeliveryPlan(opener_kind="silence", hold_silence=True)
        loud = DEFAULT_PLAN
        q = self._run(self._policy(seed=5), quiet, catalog)
        l_ = self._run(self._policy(seed=5), loud, catalog)
        assert sum(d.plays_anything for d in q) < sum(d.plays_anything for d in l_)
        holds = [d.hold_ms for d in q if d.plays_anything]
        assert holds and min(holds) >= 900.0

    def test_the_opener_leaves_a_thinking_pause_before_the_reply(self):
        catalog = build_session_catalog("en-IN")
        durations = {k: 2500.0 for k in catalog.entries}  # all too long
        decision = self._policy(post_opener_pause_ms=550.0).decide(
            DEFAULT_PLAN, catalog, durations, 2000.0, "I see."
        )
        assert decision.entry is None

    def test_bridge_never_two_turns_running_and_only_on_long_gaps(self):
        catalog = build_session_catalog("en-IN")
        plan = DeliveryPlan(bridge_line="Give me a second.")
        decisions = self._run(
            self._policy(seed=2, bridge_probability=1.0),
            plan,
            catalog,
            gap=5000.0,
            bridge_ms=900.0,
        )
        flags = [d.bridge for d in decisions]
        assert any(flags)
        assert not any(a and b for a, b in zip(flags, flags[1:]))
        short = self._policy(seed=2, bridge_probability=1.0).decide(
            plan, catalog, _durations(catalog), 1500.0, "I see.", 900.0
        )
        assert short.bridge is False


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
        hold_min_ms=1.0,
        hold_max_ms=2.0,
        weight_none=0.0,
        weight_body=0.0,
        post_opener_pause_ms=1.0,
    )
    player = OpenerPlayer(
        room_name="room-x",
        turn_delivery=td,
        policy=OpenerPolicy(cfg, rng=random.Random(0)),
        bg_audio_getter=lambda: bg,
        predicted_gap_ms=lambda: 4000.0,
        synthesize=_synth,
        emit_filler_transcript=lambda text, ts: transcripts.append(("filler", text)),
        emit_bridge_transcript=lambda text, ts: transcripts.append(("bridge", text)),
        post_opener_pause_ms=1.0,
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
        recorded = {}
        monkeypatch.setattr(
            turn_metrics, "record", lambda room, **kw: recorded.update(kw)
        )
        player.on_agent_state("thinking")
        await asyncio.sleep(0.01)
        player.on_user_state("speaking")
        await asyncio.sleep(0.05)
        assert player.stats["cancelled_by_learner"] == 1
        assert recorded["metadata"]["openerCancelledByLearner"] is True
        assert all(h.stopped for h in bg.played)

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

    @pytest.mark.asyncio
    async def test_a_new_plan_prerenders_its_bridge_and_it_plays_once(
        self, monkeypatch
    ):
        cfg = PolicyConfig(
            hold_min_ms=1.0,
            hold_max_ms=2.0,
            weight_none=0.0,
            weight_body=0.0,
            post_opener_pause_ms=1.0,
            bridge_probability=1.0,
            bridge_min_gap_ms=100.0,
        )
        player, td, bg, transcripts = _player(monkeypatch, policy_cfg=cfg)
        await player.render_catalog()
        td.on_plan(player.on_plan)
        td.set_plan(DeliveryPlan(bridge_line="That's a lot.", source="planner"))
        await asyncio.sleep(0.01)
        player.on_agent_state("thinking")
        await asyncio.sleep(0.8)
        assert ("bridge", "That's a lot.") in transcripts
        assert len(bg.played) == 2  # opener, then the bridge after a pause
        assert player._bridge is None  # heard once


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


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
    @pytest.mark.asyncio
    async def test_plan_delivery_node_skips_working_memory_scenarios(self, monkeypatch):
        from app.core.graph import nodes

        td = TurnDelivery(build_session_catalog("en-IN"))
        td.active = True
        client = Mock()
        monkeypatch.setattr(
            nodes, "prompt_declares_client_working_memory", lambda pd: True
        )
        config = {
            "configurable": {
                "turn_delivery": td,
                "delivery_llm_client": client,
                "scenario": types.SimpleNamespace(prompt_data=object()),
            }
        }
        state = types.SimpleNamespace(messages=[])
        assert await nodes.plan_delivery(state, config) == {}
        assert td.planner_in_flight is False

    @pytest.mark.asyncio
    async def test_plan_delivery_node_sets_the_plan(self, monkeypatch):
        from langchain_core.messages import AIMessage, HumanMessage

        from app.core.graph import nodes

        td = TurnDelivery(build_session_catalog("en-IN"))
        td.active = True
        monkeypatch.setattr(
            nodes, "prompt_declares_client_working_memory", lambda pd: False
        )

        async def _fake_plan(*args, **kwargs):
            return ProposedDelivery(
                opener_kind="reflective", opener_ids=["hmm_reflective"]
            )

        monkeypatch.setattr(
            "app.core.livekit.delivery_planner.plan_next_delivery", _fake_plan
        )
        config = {
            "configurable": {
                "turn_delivery": td,
                "delivery_llm_client": object(),
                "scenario": types.SimpleNamespace(prompt_data=object()),
            }
        }
        state = types.SimpleNamespace(
            messages=[HumanMessage(content="hi"), AIMessage(content="hello")]
        )
        await nodes.plan_delivery(state, config)
        await asyncio.sleep(0.05)
        assert td.plan.source == "planner"
        assert td.plan.opener_ids == ("hmm_reflective",)
        assert td.planner_in_flight is False

    @pytest.mark.asyncio
    async def test_plan_delivery_node_is_inert_until_active(self):
        from app.core.graph import nodes

        td = TurnDelivery(build_session_catalog("en-IN"))
        config = {"configurable": {"turn_delivery": td, "delivery_llm_client": 1}}
        assert (
            await nodes.plan_delivery(types.SimpleNamespace(messages=[]), config) == {}
        )
        assert td.planner_in_flight is False

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
