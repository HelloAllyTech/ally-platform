"""Per-run scratchpad: a markdown file the investigate and fix loops write notes to,
and where old tool results go when a loop's history passes its budget.

``compact(messages, budget)`` folds the oldest tool turns (an AI message with
tool calls plus its tool results) into the scratchpad as short summaries and
replaces them in the history with one plain assistant line, so the provider never
sees a tool call without its result. The system message and the newest
``keep_last`` messages are always kept.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Sequence

from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage

from bug_hunter.context.tokens import TokenCounter, make_counter, truncate_to_tokens

HEADER = "# Scratchpad\n\nNotes the agent wrote during this run, oldest first.\n"
COMPACTED = "## Compacted tool results"
NOTES = "## Notes"

Summariser = Callable[[ToolMessage], str]


def default_summariser(message: ToolMessage) -> str:
    """Deterministic one-liner: tool name, size, first non-empty line."""
    text = message.content if isinstance(message.content, str) else str(message.content)
    lines = [ln for ln in text.splitlines() if ln.strip()]
    first = lines[0][:160] if lines else "(empty)"
    name = getattr(message, "name", None) or "tool"
    return f"{name} → {len(lines)} lines; starts: {first}"


class Scratchpad:
    def __init__(self, path: Path):
        self.path = Path(path)
        if not self.path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(HEADER + f"\n{NOTES}\n", encoding="utf-8")

    def read(self) -> str:
        return self.path.read_text(encoding="utf-8")

    def append_note(self, text: str, section: str = NOTES) -> None:
        stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
        body = self.read()
        entry = f"- [{stamp}] {text.strip()}\n"
        if section in body:
            head, _sep, rest = body.partition(section + "\n")
            # insert at the end of that section (before the next "## " or EOF)
            idx = rest.find("\n## ")
            if idx == -1:
                rest = rest.rstrip("\n") + "\n" + entry
            else:
                rest = rest[:idx].rstrip("\n") + "\n" + entry + rest[idx:]
            body = head + section + "\n" + rest
        else:
            body = body.rstrip("\n") + f"\n\n{section}\n{entry}"
        self.path.write_text(body, encoding="utf-8")

    def tail(self, max_tokens: int, counter: TokenCounter | None = None) -> str:
        """The newest notes that fit ``max_tokens``, whole lines only."""
        counter = counter or make_counter()[0]
        lines = self.read().splitlines()
        kept: list[str] = []
        used = 0
        for line in reversed(lines):
            cost = counter(line + "\n")
            if used + cost > max_tokens:
                break
            kept.append(line)
            used += cost
        text = "\n".join(reversed(kept))
        return text if len(kept) == len(lines) else "… (older notes omitted)\n" + text

    # --- history compaction -------------------------------------------------------

    def compact(
        self,
        messages: Sequence[BaseMessage],
        budget: int,
        counter: TokenCounter | None = None,
        summariser: Summariser = default_summariser,
        keep_last: int = 6,
    ) -> list[BaseMessage]:
        counter = counter or make_counter()[0]
        history = list(messages)
        if _tokens(history, counter) <= budget:
            return history
        system = [m for m in history if isinstance(m, SystemMessage)]
        rest = [m for m in history if not isinstance(m, SystemMessage)]
        turns = _split_turns(rest)
        protected = max(0, len(turns) - max(1, keep_last))
        compacted: list[BaseMessage] = []
        notes: list[str] = []
        index = 0
        while (
            index < protected
            and _tokens(system + compacted + _flatten(turns[index:]), counter) > budget
        ):
            turn = turns[index]
            tool_names = []
            for message in turn:
                if isinstance(message, ToolMessage):
                    notes.append(summariser(message))
                    tool_names.append(getattr(message, "name", None) or "tool")
            if tool_names:
                compacted.append(
                    AIMessage(
                        content=(
                            f"(earlier: called {', '.join(tool_names)}; "
                            "results summarised in the scratchpad)"
                        )
                    )
                )
            else:
                compacted.extend(turn)
            index += 1
        result = system + compacted + _flatten(turns[index:])
        if notes:
            for note in notes:
                self.append_note(note, COMPACTED)
        if _tokens(result, counter) > budget:
            # last resort: truncate the biggest tool results that remain, whole lines
            for message in result:
                if isinstance(message, ToolMessage) and isinstance(
                    message.content, str
                ):
                    message.content = truncate_to_tokens(
                        message.content, max(64, budget // 8), counter
                    )
        return result


def _tokens(messages: Sequence[BaseMessage], counter: TokenCounter) -> int:
    total = 0
    for m in messages:
        content = m.content if isinstance(m.content, str) else str(m.content)
        total += counter(content) + 4
        calls = getattr(m, "tool_calls", None)
        if calls:
            total += counter(str(calls))
    return total


def _split_turns(messages: list[BaseMessage]) -> list[list[BaseMessage]]:
    """Group an AI message with tool calls together with its tool results."""
    turns: list[list[BaseMessage]] = []
    for message in messages:
        if (
            isinstance(message, ToolMessage)
            and turns
            and any(
                isinstance(m, AIMessage) and getattr(m, "tool_calls", None)
                for m in turns[-1]
            )
        ):
            turns[-1].append(message)
        else:
            turns.append([message])
    return turns


def _flatten(turns: Sequence[Sequence[BaseMessage]]) -> list[BaseMessage]:
    return [m for turn in turns for m in turn]
