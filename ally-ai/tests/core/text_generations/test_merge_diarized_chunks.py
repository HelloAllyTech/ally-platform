from app.core.text_generations.openai_text_generation_service import (
    merge_diarized_chunks,
)
from app.core.text_generations.structured_output_models import StructuredDiarizedMessage


def _m(start: float, text: str, role: str = "CLIENT") -> StructuredDiarizedMessage:
    return StructuredDiarizedMessage(
        role=role, content=text, start_time=start, end_time=start + 1
    )


def test_drops_turns_rediarized_from_the_overlap():
    chunk1 = [_m(0, "a"), _m(5, "b"), _m(10, "c")]
    # chunk 2 starts with the overlap (b, c) the splitter prepended
    chunk2 = [_m(5, "b"), _m(10, "c"), _m(15, "d"), _m(20, "e")]

    merged = merge_diarized_chunks([chunk1, chunk2])

    assert [m.content for m in merged] == ["a", "b", "c", "d", "e"]


def test_keeps_a_chunk_whole_when_timestamps_are_unusable():
    chunk1 = [_m(0, "a"), _m(0, "b")]
    chunk2 = [_m(0, "c"), _m(0, "d")]

    merged = merge_diarized_chunks([chunk1, chunk2])

    assert [m.content for m in merged] == ["a", "b", "c", "d"]


def test_single_chunk_is_unchanged():
    chunk = [_m(0, "a"), _m(3, "b")]
    assert merge_diarized_chunks([chunk]) == chunk


def test_three_chunks_in_order():
    c1 = [_m(0, "a"), _m(5, "b")]
    c2 = [_m(5, "b"), _m(9, "c")]
    c3 = [_m(9, "c"), _m(12, "d")]

    merged = merge_diarized_chunks([c1, c2, c3])

    assert [m.content for m in merged] == ["a", "b", "c", "d"]
