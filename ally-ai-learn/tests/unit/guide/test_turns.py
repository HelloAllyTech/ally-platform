"""GuideVoiceTurns: what Ally says for each ally-be outcome, and barge-in."""

import asyncio
from contextlib import aclosing

import pytest
from livekit.agents import FlushSentinel
from pydantic import TypeAdapter

from app.core.guide.client import GuideBackendError, GuideSessionEnded
from app.core.guide.contract import GuideVoiceFrame
from app.core.guide.crisis import DEFAULT_CRISIS_TEXT, DeliveryState
from app.core.guide.ledger import SpokenReplyLedger
from app.core.guide.lines import LOST_THAT_EN, SLOW_TURN_EN, LeaveReason
from app.core.guide.turns import MAX_TEXT_CHARS, GuideVoiceTurns, prepare_text

HANG = object()
_FRAME = TypeAdapter(GuideVoiceFrame)


def delta(text):
    return {"type": "delta", "text": text}


def hint(text):
    return {"type": "card_hint", "text": text}


def done(turn_id):
    return {"type": "done", "turnId": turn_id, "messageId": f"m-{turn_id}"}


def error(code):
    return {"type": "error", "code": code, "message": "x"}


class FakeClient:
    """Plays one script per request: frame dicts, HANG, a float (sleep), or an
    exception to raise."""

    def __init__(self, *scripts):
        self.scripts = list(scripts)
        self.requests = []
        self.closed = []

    async def stream_turn(self, request, *, traceparent=None):
        index = len(self.requests)
        self.requests.append(request)
        script = self.scripts.pop(0)
        try:
            if isinstance(script, BaseException):
                raise script
            for item in script:
                if item is HANG:
                    await asyncio.Event().wait()
                elif isinstance(item, float):
                    await asyncio.sleep(item)
                else:
                    yield _FRAME.validate_python(item)
        finally:
            self.closed.append(index)


class Harness:
    def __init__(self, *scripts, **options):
        self.client = FakeClient(*scripts)
        self.ledger = SpokenReplyLedger()
        self.delivery = DeliveryState()
        self.left = []
        ids = iter(f"gv-{n}" for n in range(100))
        options.setdefault("slow_turn_after_s", 0)
        options.setdefault("busy_retry_delay_s", 0)
        self.turns = GuideVoiceTurns(
            self.client,
            token="vt",
            language="en",
            ledger=self.ledger,
            delivery=self.delivery,
            on_leave=self.left.append,
            client_turn_id=lambda: next(ids),
            **options,
        )

    async def say(self, text="Can we go on?"):
        return [piece async for piece in self.turns.speak(text)]

    def sent(self, index=-1):
        return self.client.requests[index].model_dump(by_alias=True, exclude_none=True)


# -- the happy path ----------------------------------------------------------


async def test_deltas_are_spoken_as_they_arrive():
    h = Harness([delta("Hello. "), delta("Ready to start?"), done("t1")])

    assert await h.say("let's go") == ["Hello. ", "Ready to start?"]
    assert h.sent() == {
        "token": "vt",
        "clientTurnId": "gv-0",
        "text": "let's go",
        "language": "en",
    }
    assert h.client.closed == [0]
    assert h.left == []


async def test_card_hints_are_spoken_in_line_with_spacing():
    h = Harness(
        [
            delta("Here it is"),
            hint("I've opened it on your right."),
            delta("Take your time."),
            done("t2"),
        ]
    )

    assert await h.say() == [
        "Here it is",
        " I've opened it on your right. ",
        "Take your time.",
    ]


async def test_blank_utterance_sends_nothing():
    h = Harness()
    assert await h.say("   ") == []
    assert h.client.requests == []


def test_long_transcripts_are_cut_to_ally_be_limit_at_a_word():
    text = "word " * 600
    prepared = prepare_text(text)
    assert len(prepared) <= MAX_TEXT_CHARS
    assert not prepared.endswith(" ")
    assert prepared.split(" ")[-1] == "word"


# -- barge-in ------------------------------------------------------------------


async def test_barge_in_mid_stream_closes_the_stream_and_marks_nothing():
    h = Harness([delta("Well, "), HANG], [delta("Sure."), done("t2")])

    reply = h.turns.speak("tell me more")
    assert await reply.__anext__() == "Well, "
    await reply.aclose()  # LiveKit closes the llm node when the learner speaks

    assert h.client.closed == [0]
    # LiveKit reports what played; the turn had no done frame, so ally-be
    # cancelled it and stored nothing — nothing to mark.
    h.ledger.on_assistant_message("Well,", interrupted=True)
    await h.say("wait")
    assert "interruptedTurnId" not in h.sent()
    assert "spokenChars" not in h.sent()


async def test_barge_in_by_task_cancellation_closes_the_stream():
    h = Harness([delta("Well, "), HANG])
    spoke = asyncio.Event()

    async def llm_task():
        async for _ in h.turns.speak("tell me more"):
            spoke.set()

    task = asyncio.create_task(llm_task())
    await asyncio.wait_for(spoke.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert h.client.closed == [0]


async def test_interrupted_after_done_reports_the_turn_and_what_was_heard():
    h = Harness(
        [delta("Hello there. "), delta("How was the article?"), done("t1")],
        [delta("No problem."), done("t2")],
    )
    await h.say()
    # Played up to "Hello th" when the learner cut in.
    h.ledger.on_assistant_message("Hello th", interrupted=True)

    await h.say("sorry, go back")

    sent = h.sent()
    assert sent["interruptedTurnId"] == "t1"
    assert sent["spokenChars"] == len("Hello th")


async def test_spoken_chars_count_only_the_reply_not_card_hints():
    h = Harness(
        [
            delta("Here it is"),
            hint("I've opened it on your right."),
            delta("Take your time."),
            done("t2"),
        ],
        [delta("Okay."), done("t3")],
    )
    spoken = "".join(await h.say())
    heard = spoken[: len("Here it is I've opened it on your right. Take")]
    h.ledger.on_assistant_message(heard, interrupted=True)

    await h.say("hang on")

    assert h.sent()["interruptedTurnId"] == "t2"
    assert h.sent()["spokenChars"] == len("Here it is") + len("Take")


async def test_interrupted_before_any_audio_reports_zero_chars():
    h = Harness([delta("Long answer."), done("t1")], [delta("Sure."), done("t2")])
    await h.say()
    # No assistant message: LiveKit adds none when nothing played.
    await h.say("stop")
    assert h.sent()["interruptedTurnId"] == "t1"
    assert h.sent()["spokenChars"] == 0


async def test_full_playout_reports_nothing():
    h = Harness([delta("All of it."), done("t1")], [delta("Next."), done("t2")])
    await h.say()
    h.ledger.on_assistant_message("All of it.", interrupted=False)
    await h.say("next")
    assert "interruptedTurnId" not in h.sent()


async def test_interruption_is_kept_until_a_turn_completes():
    h = Harness(
        [delta("Hello there."), done("t1")],
        [error("turn_in_progress")],
        [delta("Yes."), done("t3")],
        [delta("Okay."), done("t4")],
        busy_retries=0,
    )
    await h.say()
    h.ledger.on_assistant_message("Hello", interrupted=True)

    assert await h.say("one") == []  # busy: ally-be never ran it
    assert h.sent()["interruptedTurnId"] == "t1"
    await h.say("two")
    assert h.sent()["interruptedTurnId"] == "t1"  # carried over
    h.ledger.on_assistant_message("Yes.", interrupted=False)
    await h.say("three")
    assert "interruptedTurnId" not in h.sent()  # consumed by t3


# -- error codes ---------------------------------------------------------------


async def test_turn_in_progress_retries_with_fresh_ids_then_says_nothing():
    h = Harness(
        [error("turn_in_progress")],
        [error("turn_in_progress")],
        [error("turn_in_progress")],
        busy_retries=2,
    )

    assert await h.say() == []

    ids = [r.client_turn_id for r in h.client.requests]
    assert ids == ["gv-0", "gv-1", "gv-2"]
    assert h.left == []


async def test_turn_in_progress_then_success_speaks_the_reply():
    h = Harness([error("turn_in_progress")], [delta("Yes."), done("t1")])
    assert await h.say() == ["Yes."]


async def test_guide_disabled_leaves_without_the_generic_line():
    h = Harness([error("guide_disabled")])

    assert await h.say() == []
    assert h.left == [LeaveReason.VOICE_OFF]
    assert h.turns.closed
    # No more turns once the worker is leaving.
    assert await h.say("hello?") == []
    assert len(h.client.requests) == 1


@pytest.mark.parametrize(
    "code",
    [
        "provider_unavailable",
        "internal_error",
        "rate_limited",
        "message_too_long",
        "interrupted",
        "not_enrolled",
    ],
)
async def test_other_error_codes_ask_the_learner_to_say_it_again(code):
    h = Harness([error(code)])
    assert await h.say() == [LOST_THAT_EN]
    assert h.left == []


async def test_error_after_partial_reply_appends_the_line():
    h = Harness([delta("So the main"), error("provider_unavailable")])
    assert await h.say() == ["So the main", f" {LOST_THAT_EN} "]


async def test_ally_be_unreachable_asks_the_learner_to_say_it_again():
    h = Harness(GuideBackendError("refused", code="transport"))
    assert await h.say() == [LOST_THAT_EN]


async def test_401_mid_session_leaves_with_the_session_ended_line():
    h = Harness(GuideSessionEnded())

    assert await h.say() == []
    assert h.left == [LeaveReason.SESSION_ENDED]
    assert h.turns.closed


# -- crisis --------------------------------------------------------------------


async def test_crisis_message_is_fenced_into_its_own_paced_segment():
    h = Harness([delta(DEFAULT_CRISIS_TEXT), done("t1")], [delta("Hi."), done("t2")])

    spoken = await h.say()

    assert isinstance(spoken[0], FlushSentinel)
    assert spoken[1] == DEFAULT_CRISIS_TEXT
    assert isinstance(spoken[2], FlushSentinel)
    assert h.delivery.crisis is True
    assert h.left == []  # the session stays open

    await h.say("I'm safe now")
    assert h.delivery.crisis is False


async def test_late_crisis_counts_only_the_crisis_text_as_the_reply():
    h = Harness(
        [delta("Okay, so "), delta(DEFAULT_CRISIS_TEXT), done("t1")],
        [delta("I'm here."), done("t2")],
    )
    await h.say()
    h.ledger.on_assistant_message(
        "Okay, so " + DEFAULT_CRISIS_TEXT[:20], interrupted=True
    )
    await h.say("wait")
    assert h.sent()["spokenChars"] == 20


# -- slow turns ----------------------------------------------------------------


async def test_slow_turn_line_plays_once_while_ally_be_is_quiet():
    h = Harness([0.2, delta("Here."), done("t1")], slow_turn_after_s=0.05)
    assert await h.say() == [SLOW_TURN_EN, "Here."]


async def test_no_slow_turn_line_for_a_prompt_reply():
    h = Harness([delta("Here."), done("t1")], slow_turn_after_s=5)
    assert await h.say() == ["Here."]


async def test_slow_turn_line_does_not_break_barge_in():
    h = Harness([HANG], slow_turn_after_s=0.01)
    reply = h.turns.speak("hello")
    async with aclosing(reply):
        assert await reply.__anext__() == SLOW_TURN_EN
    assert h.client.closed == [0]
