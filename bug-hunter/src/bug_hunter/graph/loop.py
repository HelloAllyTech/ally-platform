"""A ReAct-style tool loop as a LangGraph subgraph (spec §2): ``agent`` calls tools or
one of the *finish tools* (``submit_finding``, ``report_no_bug``, …) whose validated
arguments are the loop's structured result. Every model call is charged to the run's
budget; the loop stops on a finish tool, on the budget, or on the tool-turn limit (then
the model gets one last call with only the finish tools bound).

The parent node invokes the subgraph with the parent's config, so its steps are
checkpointed under the parent's namespace; on resume the wrapper continues a loop that
was cut off mid-way instead of restarting it (``run_loop``).
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.runnables import Runnable, RunnableConfig
from langchain_core.tools import BaseTool
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from bug_hunter.config import BugHunterConfig, ModelSpec
from bug_hunter.context.scratchpad import Scratchpad
from bug_hunter.context.tokens import TokenCounter, effective_budget, make_counter
from bug_hunter.graph.budget import charge, exceeded
from bug_hunter.graph.state import Budget
from bug_hunter.safety.phi import scrub_code

TOOL_RESULT_MAX_CHARS = 12_000
NUDGE = (
    "Use a tool to look at the code, or finish with one of the finish tools. "
    "Plain text answers are not recorded."
)
FINAL_NUDGE = (
    "You have used all your tool turns. Finish now with one of the finish tools, "
    "using what you have learned so far. If you are not sure, say so: an unproven "
    "finding is worse than none."
)


REPEATABLE_READS = ("read_file", "grep", "glob", "list_dir", "outline", "git_log")


class LoopState(TypedDict, total=False):
    messages: list[BaseMessage]
    turns: int
    seen_calls: dict[str, int]  # identical read-only calls -> turn first made
    result: dict[str, Any] | None  # {"tool": name, "args": {...}}
    loop_stop: str | None  # why it ended without a finish tool
    budget_used: Budget
    started_at: str
    app: str | None  # picks the per-app wall-clock cap
    node: str


@dataclass
class ToolLoop:
    """Everything one loop needs; ``build()`` compiles the subgraph."""

    config: BugHunterConfig
    node: str
    model: BaseChatModel | Runnable
    spec: ModelSpec  # for pricing when the response does not name its model
    tools: Sequence[BaseTool]
    finish_tools: Sequence[BaseTool]
    scratchpad: Scratchpad | None = None
    counter: TokenCounter | None = None
    message_budget: int | None = None  # tokens the history may hold before compaction
    max_turns: int | None = None
    on_tool_call: Callable[[str, dict[str, Any], str], None] | None = None
    _by_name: dict[str, BaseTool] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        self._by_name = {t.name: t for t in [*self.tools, *self.finish_tools]}
        if self.counter is None:
            self.counter = make_counter(
                self.config.limits.context.chars_per_token_offline
            )[0]
        if self.max_turns is None:
            self.max_turns = self.config.limits.run.max_tool_turns
        if self.message_budget is None:
            budget = self.config.limits.nodes.get(self.node, 40_000)
            self.message_budget = effective_budget(
                budget, self.config.limits.context.token_safety_margin
            )

    @property
    def finish_names(self) -> set[str]:
        return {t.name for t in self.finish_tools}

    # --- nodes ----

    def agent(self, state: LoopState) -> dict[str, Any]:
        budget: Budget = state["budget_used"]
        reason = exceeded(
            self.config, budget, state.get("started_at", ""), state.get("app")
        )
        if reason:
            return {"loop_stop": reason}
        messages = list(state["messages"])
        turns = state.get("turns", 0)
        last_call = turns >= (self.max_turns or 0)
        if last_call:
            messages.append(HumanMessage(content=FINAL_NUDGE))
            bound = self.model.bind_tools(list(self.finish_tools), tool_choice="any")
        else:
            bound = self.model.bind_tools([*self.tools, *self.finish_tools])
        started = time.monotonic()
        response = bound.invoke(messages)
        seconds = time.monotonic() - started
        if not isinstance(response, AIMessage):
            response = AIMessage(content=str(response))
        budget = charge(
            self.config, budget, self.node, self._spec_of(response), response, seconds
        )
        messages.append(response)
        update: dict[str, Any] = {"messages": messages, "budget_used": budget}
        finish = [c for c in response.tool_calls if c["name"] in self.finish_names]
        if finish:
            call = finish[0]
            tool = self._by_name[call["name"]]
            try:
                schema = tool.args_schema
                args = schema.model_validate(call["args"]).model_dump()  # type: ignore
            except Exception as exc:  # noqa: BLE001 - tell the model, let it retry
                messages.append(
                    ToolMessage(
                        content=f"error: invalid arguments for {call['name']}: {exc}",
                        tool_call_id=call["id"] or call["name"],
                        name=call["name"],
                    )
                )
                update["turns"] = turns + 1
                if last_call:
                    update["loop_stop"] = f"finish tool arguments invalid: {exc}"[:300]
                return update
            update["result"] = {"tool": call["name"], "args": args}
            return update
        if last_call:
            update["loop_stop"] = "tool turn limit reached without a finish tool"
            return update
        if not response.tool_calls:
            messages.append(HumanMessage(content=NUDGE))
            update["turns"] = turns + 1
        return update

    def tools_node(self, state: LoopState) -> dict[str, Any]:
        messages = list(state["messages"])
        last = messages[-1]
        assert isinstance(last, AIMessage)
        seen: dict[str, int] = dict(state.get("seen_calls") or {})
        for call in last.tool_calls:
            if call["name"] in self.finish_names:
                continue
            tool = self._by_name.get(call["name"])
            key = json.dumps([call["name"], call["args"]], sort_keys=True, default=str)
            if tool is None:
                text = f"error: unknown tool {call['name']}"
            elif key in seen and call["name"] in REPEATABLE_READS:
                # the same read twice in one loop: the first result is still in the
                # history (or summarised in the scratchpad); do not pay for it again
                text = (
                    f"(identical {call['name']} call already made in turn {seen[key]}; "
                    "its result is above or summarised in the scratchpad. Read a "
                    "different range or file.)"
                )
            else:
                try:
                    text = str(tool.invoke(call["args"]))
                except Exception as exc:  # noqa: BLE001 - the model needs the message
                    text = f"error: {exc}"
            seen.setdefault(key, state.get("turns", 0) + 1)
            # tool results are code and listings: pattern scrub only. The data
            # scrubber's key rules turned `userId: x` in Dart/TS into [redacted:userid]
            # and agents then hunted phantom "placeholders left in the code".
            text = scrub_code(text)
            if len(text) > TOOL_RESULT_MAX_CHARS:
                text = text[:TOOL_RESULT_MAX_CHARS] + "\n… (truncated)"
            if self.on_tool_call:
                self.on_tool_call(call["name"], dict(call["args"]), text)
            messages.append(
                ToolMessage(
                    content=text,
                    tool_call_id=call["id"] or call["name"],
                    name=call["name"],
                )
            )
        if self.scratchpad is not None and self.message_budget:
            messages = self.scratchpad.compact(
                messages, self.message_budget, self.counter
            )
        return {
            "messages": messages,
            "turns": state.get("turns", 0) + 1,
            "seen_calls": seen,
        }

    @staticmethod
    def route(state: LoopState) -> str:
        if state.get("result") is not None or state.get("loop_stop"):
            return END
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return "agent"

    def _spec_of(self, message: AIMessage) -> ModelSpec:
        """Price by the model the response names (a fallback may have answered)."""
        name = (message.response_metadata or {}).get("model_name") or (
            message.response_metadata or {}
        ).get("model")
        if name:
            for key in self.config.models.prices:
                provider, _, model = key.partition(":")
                if name == model or name.startswith(model):
                    return ModelSpec(provider=provider, model=model)
        return self.spec

    # --- graph ----

    def build(self):
        graph: StateGraph = StateGraph(LoopState)
        graph.add_node("agent", self.agent)
        graph.add_node("tools", self.tools_node)
        graph.add_edge(START, "agent")
        graph.add_conditional_edges("agent", self.route, ["tools", "agent", END])
        graph.add_edge("tools", "agent")
        return graph.compile()


def initial_messages(system: str, user: str) -> list[BaseMessage]:
    return [SystemMessage(content=system), HumanMessage(content=user)]


def recursion_limit_for(max_turns: int) -> int:
    """Each tool turn is two graph steps (agent, tools) plus nudges; LangGraph's default
    of 25 would kill any investigation past ~12 tool turns with GraphRecursionError."""
    return 3 * max_turns + 10


def run_loop(
    compiled,
    initial: LoopState,
    config: RunnableConfig | None,
    checkpointer: BaseCheckpointSaver | None = None,
    max_turns: int | None = None,
) -> LoopState:
    """Invoke the loop; if a checkpoint for this namespace is mid-loop (the process was
    killed), continue it instead of starting over."""
    limit = recursion_limit_for(max_turns or 30)
    config = {**(config or {}), "recursion_limit": limit}
    if checkpointer is not None and config.get("configurable"):
        try:
            snapshot = compiled.get_state(config)
        except Exception:  # noqa: BLE001 - no state for this namespace
            snapshot = None
        if snapshot is not None and snapshot.next and snapshot.values.get("messages"):
            return compiled.invoke(None, config)
    return compiled.invoke(initial, config)


def result_json(state: LoopState) -> str:
    return json.dumps(state.get("result"), indent=1, default=str)
