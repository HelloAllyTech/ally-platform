"""Scratchpad notes and history compaction (deterministic summariser, offline)."""

from __future__ import annotations

from pathlib import Path

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from bug_hunter.context.scratchpad import COMPACTED, Scratchpad
from bug_hunter.context.tokens import offline_counter


def test_notes_append_in_order(tmp_path: Path) -> None:
    pad = Scratchpad(tmp_path / "s.md")
    pad.append_note("checked X, ruled out")
    pad.append_note("Y is the cause")
    body = pad.read()
    assert body.index("checked X") < body.index("Y is the cause")
    assert body.startswith("# Scratchpad")
    tail = pad.tail(12, offline_counter(3))
    assert "Y is the cause" in tail and tail.startswith("… (older notes omitted)")


def _history(turns: int) -> list:
    msgs: list = [
        SystemMessage(content="system prompt"),
        HumanMessage(content="find the bug"),
    ]
    for i in range(turns):
        msgs.append(
            AIMessage(
                content="",
                tool_calls=[
                    {"name": "read_file", "args": {"path": f"f{i}"}, "id": f"c{i}"}
                ],
            )
        )
        msgs.append(
            ToolMessage(
                content=f"line one of f{i}\n" + ("x" * 300),
                tool_call_id=f"c{i}",
                name="read_file",
            )
        )
    return msgs


def test_compact_folds_oldest_tool_turns_into_the_scratchpad(tmp_path: Path) -> None:
    pad = Scratchpad(tmp_path / "s.md")
    count = offline_counter(3)
    history = _history(8)
    full = sum(count(m.content) for m in history)
    result = pad.compact(history, budget=full // 2, counter=count, keep_last=4)
    assert isinstance(result[0], SystemMessage) and result[1].content == "find the bug"
    # the newest two turns (4 messages) survive intact
    assert isinstance(result[-1], ToolMessage) and result[-1].name == "read_file"
    assert result[-1].content.startswith("line one of f7")
    # older turns became one assistant line each, never a dangling tool call
    for message in result:
        if isinstance(message, AIMessage) and getattr(message, "tool_calls", None):
            idx = result.index(message)
            assert isinstance(result[idx + 1], ToolMessage)
    folded = [
        m
        for m in result
        if isinstance(m, AIMessage) and "summarised in the scratchpad" in m.content
    ]
    assert folded
    body = pad.read()
    assert COMPACTED in body and "read_file → " in body and "line one of f0" in body


def test_compact_is_a_no_op_under_budget(tmp_path: Path) -> None:
    pad = Scratchpad(tmp_path / "s.md")
    history = _history(2)
    assert pad.compact(history, budget=10_000, counter=offline_counter(3)) == history
    assert COMPACTED not in pad.read()
