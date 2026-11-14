"""Assemble a node's prompt inputs within its token budget.

Each node declares the state fields it reads (``NODE_INPUTS``). ``build_context``
renders those plus the app context, the memory-recall slot and the scratchpad tail,
counts tokens, and trims in a fixed order until the effective budget
(``limits.nodes[node] × (1 − safety margin)``) holds:

1. memory recall items, newest-last dropped first
2. scratchpad tail, shrunk to half, then to its last 10 lines, then dropped
3. app context, reduced to commands and rules (``render_short``)
4. state lists lose whole items from the end, with an "N more omitted" marker;
   long state strings are cut at a line boundary with a marker
5. if still over: ``BudgetError`` — nothing is ever cut silently mid-file

``review`` is deliberately blind to the investigator's reasoning (spec §7): it reads
the finding, repro, patch and verification only, never the scratchpad.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from pydantic import BaseModel

from bug_hunter.config import BugHunterConfig
from bug_hunter.context.app_context import AppContext
from bug_hunter.context.scratchpad import Scratchpad
from bug_hunter.context.tokens import (
    TokenCounter,
    effective_budget,
    make_counter,
    truncate_to_tokens,
)

NODE_INPUTS: dict[str, tuple[str, ...]] = {
    "triage": ("signal",),
    "investigate": ("signal", "finding"),
    "reproduce": ("finding", "root_cause"),
    "fix": ("finding", "repro", "root_cause"),
    "review": ("signal", "finding", "repro", "patch", "verification"),
    "learn": ("signal", "finding", "root_cause", "patch", "review", "status"),
}
NODES_WITH_SCRATCHPAD = ("investigate", "reproduce", "fix", "learn")
NODES_WITH_MEMORY = ("triage", "investigate", "fix")
SCRATCHPAD_SHARE = 0.25  # of the node budget, at most


class BudgetError(ValueError):
    pass


@dataclass
class NodeContext:
    node: str
    budget: int
    effective: int
    tokens: int
    counter_source: str
    sections: dict[str, str] = field(default_factory=dict)
    trimmed: list[str] = field(default_factory=list)

    def render(self) -> str:
        parts = []
        for name, text in self.sections.items():
            if text:
                parts.append(f"<{name}>\n{text}\n</{name}>")
        return "\n\n".join(parts)


def render_value(value: Any, indent: int = 0) -> str:
    pad = "  " * indent
    if value is None:
        return f"{pad}(none)"
    if isinstance(value, BaseModel):
        return render_value(value.model_dump(), indent)
    if isinstance(value, Mapping):
        lines = []
        for key, item in value.items():
            if isinstance(item, (Mapping, list, tuple, BaseModel)):
                lines.append(f"{pad}{key}:")
                lines.append(render_value(item, indent + 1))
            else:
                lines.append(f"{pad}{key}: {item}")
        return "\n".join(lines)
    if isinstance(value, (list, tuple)):
        return (
            "\n".join(f"{pad}- {render_value(item, 0).strip()}" for item in value)
            or f"{pad}(empty)"
        )
    return f"{pad}{value}"


def _state_items(value: Any) -> list[Any] | None:
    """The list behind a state value, if it is list-shaped."""
    if isinstance(value, (list, tuple)):
        return list(value)
    return None


def build_context(
    config: BugHunterConfig,
    node: str,
    state: Mapping[str, Any],
    app_context: AppContext | None = None,
    scratchpad: Scratchpad | None = None,
    memory_recall: Sequence[str] | None = None,
    extra: Mapping[str, str] | None = None,
    counter: TokenCounter | None = None,
    budget: int | None = None,
) -> NodeContext:
    if node not in NODE_INPUTS:
        raise BudgetError(f"unknown node {node!r}; known: {', '.join(NODE_INPUTS)}")
    limits = config.limits
    if budget is None:
        budget = limits.nodes.get(node)
        if budget is None:
            raise BudgetError(f"limits.yaml has no token budget for node {node!r}")
    effective = effective_budget(budget, limits.context.token_safety_margin)
    if counter is None:
        counter, source = make_counter(limits.context.chars_per_token_offline)
    else:
        source = "custom"

    fields = NODE_INPUTS[node]
    state_values: dict[str, Any] = {name: state.get(name) for name in fields}
    recall = list(memory_recall or []) if node in NODES_WITH_MEMORY else []
    pad_text = ""
    if scratchpad is not None and node in NODES_WITH_SCRATCHPAD:
        pad_text = scratchpad.tail(int(effective * SCRATCHPAD_SHARE), counter)
    app_text = app_context.render() if app_context else ""
    extra = dict(extra or {})
    trimmed: list[str] = []

    def assemble() -> dict[str, str]:
        sections: dict[str, str] = {}
        if app_text:
            sections["app_context"] = app_text
        if recall:
            sections["memory_recall"] = "\n".join(f"- {item}" for item in recall)
        for name in fields:
            sections[name] = render_value(state_values[name])
        if pad_text:
            sections["scratchpad"] = pad_text
        for key, text in extra.items():
            sections[key] = text
        return sections

    def total(sections: Mapping[str, str]) -> int:
        return sum(counter(text) + 8 for text in sections.values())

    sections = assemble()
    # 1. memory recall
    while total(sections) > effective and recall:
        recall.pop()
        trimmed.append("memory_recall item")
        sections = assemble()
    # 2. scratchpad
    if total(sections) > effective and pad_text and scratchpad is not None:
        pad_text = scratchpad.tail(int(effective * SCRATCHPAD_SHARE / 2), counter)
        trimmed.append("scratchpad halved")
        sections = assemble()
    if total(sections) > effective and pad_text:
        pad_text = "\n".join(pad_text.splitlines()[-10:])
        trimmed.append("scratchpad to last 10 lines")
        sections = assemble()
    if total(sections) > effective and pad_text:
        pad_text = ""
        trimmed.append("scratchpad dropped")
        sections = assemble()
    # 3. app context
    if total(sections) > effective and app_context is not None and app_text:
        app_text = app_context.render_short()
        trimmed.append("app_context to short form")
        sections = assemble()
    # 4. state fields: whole list items first (with an "N more omitted" marker),
    #    then long strings at a line boundary; biggest field first
    while total(sections) > effective:
        order = sorted(
            fields, key=lambda name: counter(sections.get(name, "")), reverse=True
        )
        shrunk = False
        for name in order:
            result = shrink(state_values[name], counter)
            if result is not None:
                state_values[name], what = result
                trimmed.append(f"{name}: {what}")
                shrunk = True
                break
        if not shrunk:
            break
        sections = assemble()
    tokens = total(sections)
    if tokens > effective:
        raise BudgetError(
            f"{node}: context needs {tokens} tokens but the effective budget is "
            f"{effective} ({budget} minus safety margin); nothing left to trim: "
            f"{', '.join(sections)}"
        )
    return NodeContext(node, budget, effective, tokens, source, sections, trimmed)


OMITTED = "more omitted)"


def _omitted_count(marker: Any) -> int:
    if not isinstance(marker, str) or not marker.endswith(OMITTED):
        return 0
    try:
        return int(marker.strip("()").split()[0])
    except (ValueError, IndexError):
        return 0


def _drop_last(items: list[Any]) -> list[Any] | None:
    """Drop the last real item and keep one trailing "(N more omitted)" marker."""
    omitted = _omitted_count(items[-1]) if items else 0
    real = items[:-1] if omitted else list(items)
    if len(real) <= 1:
        return None
    real.pop()
    return real + [f"({omitted + 1} {OMITTED}"]


def shrink(value: Any, counter: TokenCounter) -> tuple[Any, str] | None:
    """One trimming step on a state value, or None when nothing can be cut:
    lists lose their last item; mappings shrink their largest list, else their
    largest long string; strings are cut at a line boundary."""
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if isinstance(value, (list, tuple)):
        dropped = _drop_last(list(value))
        return (dropped, "item dropped") if dropped is not None else None
    if isinstance(value, Mapping):
        data = dict(value)
        lists = [
            (k, v)
            for k, v in data.items()
            if isinstance(v, (list, tuple)) and len(v) > 1
        ]
        if lists:
            key, items = max(lists, key=lambda kv: counter(render_value(kv[1])))
            dropped = _drop_last(list(items))
            if dropped is not None:
                data[key] = dropped
                return data, f"{key}: item dropped"
        strings = [
            (k, v) for k, v in data.items() if isinstance(v, str) and counter(v) > 48
        ]
        if strings:
            key, text = max(strings, key=lambda kv: counter(kv[1]))
            data[key] = truncate_to_tokens(text, max(32, counter(text) // 2), counter)
            return data, f"{key}: truncated at a line boundary"
        return None
    if isinstance(value, str) and counter(value) > 48:
        return (
            truncate_to_tokens(value, max(32, counter(value) // 2), counter),
            "truncated at a line boundary",
        )
    return None
