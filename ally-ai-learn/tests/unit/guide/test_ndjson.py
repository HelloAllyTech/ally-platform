"""NDJSON decoding of the voice turn stream."""

import json

from app.core.guide.contract import (
    GuideVoiceFrameCardHint,
    GuideVoiceFrameDelta,
    GuideVoiceFrameDone,
    GuideVoiceFrameError,
)
from app.core.guide.ndjson import NdjsonFrameDecoder, parse_frame_line


def _line(frame: dict) -> bytes:
    return (json.dumps(frame, ensure_ascii=False) + "\n").encode("utf-8")


def test_whole_lines_in_one_chunk():
    decoder = NdjsonFrameDecoder()
    chunk = _line({"type": "delta", "text": "Hello"}) + _line(
        {"type": "done", "turnId": "t1", "messageId": "m1"}
    )

    frames = decoder.feed(chunk)

    assert [type(f) for f in frames] == [GuideVoiceFrameDelta, GuideVoiceFrameDone]
    assert frames[0].text == "Hello"
    assert frames[1].turn_id == "t1"
    assert decoder.flush() == []


def test_a_line_split_across_chunks_is_held_until_complete():
    decoder = NdjsonFrameDecoder()
    raw = _line({"type": "delta", "text": "Let's look at that together."})
    first, second = raw[:17], raw[17:]

    assert decoder.feed(first) == []
    frames = decoder.feed(second)

    assert len(frames) == 1
    assert frames[0].text == "Let's look at that together."


def test_a_multibyte_character_split_across_chunks_survives():
    decoder = NdjsonFrameDecoder()
    raw = _line({"type": "delta", "text": "नमस्ते, चलिए शुरू करते हैं।"})
    # Cut inside a Devanagari character's UTF-8 sequence.
    cut = raw.index("स".encode("utf-8")) + 1

    frames = decoder.feed(raw[:cut]) + decoder.feed(raw[cut:])

    assert [f.text for f in frames] == ["नमस्ते, चलिए शुरू करते हैं।"]


def test_byte_at_a_time():
    decoder = NdjsonFrameDecoder()
    raw = _line({"type": "card_hint", "text": "It's just below."}) + _line(
        {"type": "done", "turnId": "t9", "messageId": ""}
    )
    frames = []
    for i in range(len(raw)):
        frames += decoder.feed(raw[i : i + 1])

    assert isinstance(frames[0], GuideVoiceFrameCardHint)
    assert isinstance(frames[1], GuideVoiceFrameDone)


def test_flush_yields_a_last_line_without_newline():
    decoder = NdjsonFrameDecoder()
    decoder.feed(b'{"type":"done","turnId":"t2","messageId":"m2"}')

    frames = decoder.flush()

    assert len(frames) == 1 and frames[0].turn_id == "t2"


def test_blank_and_crlf_lines_are_tolerated():
    decoder = NdjsonFrameDecoder()
    frames = decoder.feed(b'\n\r\n{"type":"delta","text":"Hi"}\r\n\n')
    assert [f.text for f in frames] == ["Hi"]


def test_garbage_and_unknown_frames_are_skipped_not_fatal():
    decoder = NdjsonFrameDecoder()
    frames = decoder.feed(
        b'not json\n{"type":"teapot"}\n[1,2]\n{"type":"delta","text":"ok"}\n'
    )
    assert [f.text for f in frames] == ["ok"]


def test_error_frame_with_an_unknown_code_is_still_an_error():
    frame = parse_frame_line(
        '{"type":"error","code":"brand_new_code","message":"Something new"}'
    )
    assert isinstance(frame, GuideVoiceFrameError)
    assert frame.code == "internal_error"
    assert frame.message == "Something new"


def test_known_error_frame_keeps_its_code():
    frame = parse_frame_line(
        '{"type":"error","code":"turn_in_progress","message":"busy"}'
    )
    assert isinstance(frame, GuideVoiceFrameError)
    assert frame.code == "turn_in_progress"
