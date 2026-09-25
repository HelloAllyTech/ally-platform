import json
from dataclasses import dataclass, field
from typing import List, Optional
from unittest.mock import patch

import pytest

from app.core.working_memory import recall_log
from app.core.working_memory.recall_log import MAX_PASSED_OVER, emit_recall


@dataclass
class _Fact:
    text: str
    encoding_strength: float = 1.0
    last_recalled_turn: Optional[int] = None
    stances_seen: List[str] = field(default_factory=list)


@dataclass
class _Scored:
    fact: _Fact
    score: float
    cue_hits: int = 0
    mood_congruent: bool = False
    spread: bool = False
    similarity: float = 0.0


def _sent(send):
    assert send.called, "nothing was emitted"
    body = send.call_args[0][0]
    return json.loads(body)["data"]["wm_recall"]


async def _emit(scored, selected_texts, **over):
    args = {
        "room_id": "ss_room-1",
        "turn_index": 7,
        "stance": "guarded",
        "cue_tier": "nominated",
        "cue_count": 2,
        "scored": scored,
        "selected_texts": selected_texts,
        "cap": 5,
    }
    args.update(over)
    with patch.object(recall_log.msg_event_queue, "send_message") as send:
        await emit_recall(**args)
        return send


class TestPayload:
    @pytest.mark.asyncio
    async def test_reports_what_was_passed_over_as_well_as_what_was_chosen(self):
        chosen = _Scored(_Fact("she ran a tailoring shop"), score=1.9, cue_hits=3)
        missed = _Scored(_Fact("her son moved abroad last year"), score=1.7, cue_hits=2)
        body = _sent(await _emit([chosen, missed], ["she ran a tailoring shop"]))

        assert [row["text"] for row in body["selected"]] == ["she ran a tailoring shop"]
        assert [row["text"] for row in body["passed_over"]] == [
            "her son moved abroad last year"
        ]

    @pytest.mark.asyncio
    async def test_carries_every_term_that_decided_a_candidate(self):
        # A score with no components is a number nobody can act on: it cannot say
        # whether the
        # cue weighting or the decay curve produced it.
        scored = _Scored(
            _Fact(
                "she covers it by asking you to pass the thing",
                encoding_strength=1.4,
                last_recalled_turn=3,
                stances_seen=["guarded", "open"],
            ),
            score=2.2,
            cue_hits=2,
            similarity=0.61,
            mood_congruent=True,
            spread=True,
        )
        row = _sent(await _emit([scored], []))["passed_over"][0]

        assert row["score"] == 2.2
        assert row["cue_hits"] == 2
        assert row["similarity"] == 0.61
        assert row["mood_congruent"] is True
        assert row["spread"] is True
        assert row["encoding_strength"] == 1.4
        assert row["last_recalled_turn"] == 3
        assert row["stances_seen"] == 2

    @pytest.mark.asyncio
    async def test_orders_the_near_misses_first_and_caps_them(self):
        # The tail of the pool carries no information; the fact that just missed does.
        scored = [_Scored(_Fact(f"fact {i}"), score=i / 10) for i in range(30)]
        body = _sent(await _emit(scored, []))

        assert len(body["passed_over"]) == MAX_PASSED_OVER
        scores = [row["score"] for row in body["passed_over"]]
        assert scores == sorted(scores, reverse=True)

    @pytest.mark.asyncio
    async def test_records_the_pool_it_chose_from_and_the_cap(self):
        scored = [_Scored(_Fact(f"fact {i}"), score=0.5) for i in range(12)]
        body = _sent(await _emit(scored, []))
        assert body["pool_size"] == 12
        assert body["cap"] == 5

    @pytest.mark.asyncio
    async def test_truncates_a_long_fact_rather_than_shipping_a_paragraph(self):
        scored = [_Scored(_Fact("x" * 900), score=1.0)]
        body = _sent(await _emit(scored, []))
        assert len(body["passed_over"][0]["text"]) == 240

    @pytest.mark.asyncio
    async def test_travels_as_its_own_message_type(self):
        send = await _emit([_Scored(_Fact("a"), score=1.0)], [])
        assert json.loads(send.call_args[0][0])["message_type"] == "wm_recall"

    @pytest.mark.asyncio
    async def test_says_which_source_supplied_the_cues(self):
        body = _sent(
            await _emit([_Scored(_Fact("a"), score=1.0)], [], cue_tier="scenario")
        )
        assert body["cue_tier"] == "scenario"


class TestNeverInTheWay:
    @pytest.mark.asyncio
    async def test_says_nothing_for_a_preview_room(self):
        send = await _emit([_Scored(_Fact("a"), score=1.0)], [], room_id="preview-abc")
        send.assert_not_called()

    @pytest.mark.asyncio
    async def test_says_nothing_without_a_room(self):
        send = await _emit([_Scored(_Fact("a"), score=1.0)], [], room_id=None)
        send.assert_not_called()

    @pytest.mark.asyncio
    async def test_says_nothing_when_there_was_no_pool(self):
        send = await _emit([], [])
        send.assert_not_called()

    @pytest.mark.asyncio
    async def test_swallows_a_queue_failure(self):
        # Telemetry must never cost a turn its working-memory update.
        with patch.object(
            recall_log.msg_event_queue,
            "send_message",
            side_effect=RuntimeError("sqs"),
        ):
            await emit_recall(
                room_id="ss_room-1",
                turn_index=1,
                stance="guarded",
                cue_tier="nominated",
                cue_count=1,
                scored=[_Scored(_Fact("a"), score=1.0)],
                selected_texts=[],
                cap=5,
            )


class TestCueTier:
    """The ladder recall itself walks: nomination, then the learner's words, then the
    scenario."""

    def _tier(self, cues, learner, scenario):
        from app.core.working_memory.consolidate import _cue_tier

        class _Update:
            retrieve_cues = cues

        return _cue_tier(_Update(), learner, scenario)

    def test_a_nomination_wins(self):
        assert self._tier(["panic episodes"], "anything", "anything") == "nominated"

    def test_blank_nominations_do_not_count_as_one(self):
        # An updater emitting ["", "  "] nominated nothing; counting it would hide the
        # fall
        # through to the learner's own words.
        assert (
            self._tier(["", "   "], "I keep forgetting things", None) == "learner_text"
        )

    def test_falls_back_to_the_learners_words(self):
        assert (
            self._tier([], "I keep forgetting things", "a scenario") == "learner_text"
        )

    def test_then_to_the_scenario(self):
        # The opening turn, and any content-free turn ("mm-hmm"), land here.
        assert (
            self._tier([], None, "his scores dropped, something happened at home")
            == "scenario"
        )

    def test_and_says_none_when_there_is_nothing(self):
        assert self._tier([], None, None) == "none"
