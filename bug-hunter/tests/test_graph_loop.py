"""The tool loop: finish tools, nudges, turn limit, budget stop, tool execution,
compaction into the scratchpad, and resuming a loop that was cut off."""

from __future__ import annotations

from pathlib import Path

from langchain_core.tools import StructuredTool
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel

from bug_hunter.config import BugHunterConfig, ModelSpec
from bug_hunter.context.scratchpad import Scratchpad
from bug_hunter.graph.loop import LoopState, ToolLoop, initial_messages, run_loop
from bug_hunter.graph.state import Budget
from tests.fakes import ScriptedChatModel, ai


class Answer(BaseModel):
    text: str


class EchoArgs(BaseModel):
    value: str


def _echo(value: str) -> str:
    return f"echo:{value} ops@example.com"


def _loop(config: BugHunterConfig, tmp_path: Path, script, **over) -> ToolLoop:
    model = ScriptedChatModel(script=script)
    finish = StructuredTool.from_function(
        func=lambda text: "ok", name="finish", description="done", args_schema=Answer
    )
    echo = StructuredTool.from_function(
        func=_echo, name="echo", description="echo", args_schema=EchoArgs
    )
    kwargs = dict(
        config=config,
        node="investigate",
        model=model,
        spec=ModelSpec(provider="openai", model="gpt-5"),
        tools=[echo],
        finish_tools=[finish],
        scratchpad=Scratchpad(tmp_path / "pad.md"),
    )
    kwargs.update(over)
    return ToolLoop(**kwargs)


def _initial(**over) -> LoopState:
    state: LoopState = {
        "messages": initial_messages("sys", "go"),
        "turns": 0,
        "result": None,
        "loop_stop": None,
        "budget_used": Budget(),
        "started_at": "",
        "node": "investigate",
    }
    state.update(over)  # type: ignore[typeddict-item]
    return state


def test_tool_call_then_finish_is_the_result(config, tmp_path) -> None:
    loop = _loop(
        config,
        tmp_path,
        [
            ai(tool_calls=[{"name": "echo", "args": {"value": "a"}}]),
            ai(tool_calls=[{"name": "finish", "args": {"text": "done"}}]),
        ],
    )
    out = loop.build().invoke(_initial())
    assert out["result"] == {"tool": "finish", "args": {"text": "done"}}
    tool_msgs = [m for m in out["messages"] if m.type == "tool"]
    assert (
        tool_msgs[0].content.startswith("echo:a")
        and "ops@example.com" not in tool_msgs[0].content
    )
    assert out["turns"] == 1
    assert out["budget_used"].per_node["investigate"].calls == 2
    assert out["budget_used"].cost_usd > 0


def test_plain_text_is_nudged_and_counts_as_a_turn(config, tmp_path) -> None:
    loop = _loop(
        config,
        tmp_path,
        [
            ai("thinking out loud"),
            ai(tool_calls=[{"name": "finish", "args": {"text": "d"}}]),
        ],
    )
    out = loop.build().invoke(_initial())
    assert out["result"]["args"]["text"] == "d"
    assert any(
        "Plain text answers are not recorded" in str(m.content) for m in out["messages"]
    )


def test_turn_limit_gives_one_last_call_with_finish_tools_only(
    config, tmp_path
) -> None:
    script = [
        ai(tool_calls=[{"name": "echo", "args": {"value": str(i)}}]) for i in range(3)
    ]
    script.append(ai(tool_calls=[{"name": "finish", "args": {"text": "late"}}]))
    loop = _loop(config, tmp_path, script, max_turns=3)
    out = loop.build().invoke(_initial())
    assert out["result"]["args"]["text"] == "late"
    model: ScriptedChatModel = loop.model  # type: ignore[assignment]
    assert model.bound_tools[-1] == ["finish"] and model.bound_kwargs[-1] == {
        "tool_choice": "any"
    }
    assert any("used all your tool turns" in str(m.content) for m in out["messages"])


def test_turn_limit_without_finish_stops_the_loop(config, tmp_path) -> None:
    script = [ai(tool_calls=[{"name": "echo", "args": {"value": "x"}}])] * 2 + [
        ai("I give up")
    ]
    loop = _loop(config, tmp_path, script, max_turns=2)
    out = loop.build().invoke(_initial())
    assert out["result"] is None and "turn limit" in out["loop_stop"]


def test_budget_exceeded_stops_before_calling_the_model(config, tmp_path) -> None:
    loop = _loop(config, tmp_path, [])
    cap = config.limits.run.max_cost_usd
    out = loop.build().invoke(_initial(budget_used=Budget(cost_usd=cap)))
    assert "cost budget exceeded" in out["loop_stop"] and out["result"] is None


def test_invalid_finish_arguments_are_reported_back(config, tmp_path) -> None:
    loop = _loop(
        config,
        tmp_path,
        [
            ai(tool_calls=[{"name": "finish", "args": {"wrong": 1}}]),
            ai(tool_calls=[{"name": "finish", "args": {"text": "ok"}}]),
        ],
    )
    out = loop.build().invoke(_initial())
    assert out["result"]["args"] == {"text": "ok"}
    assert any(
        "invalid arguments for finish" in str(m.content) for m in out["messages"]
    )


def test_history_is_compacted_into_the_scratchpad(config, tmp_path) -> None:
    script = [
        ai(tool_calls=[{"name": "echo", "args": {"value": "v" * 400}}])
        for _ in range(8)
    ]
    script.append(ai(tool_calls=[{"name": "finish", "args": {"text": "d"}}]))
    loop = _loop(config, tmp_path, script, message_budget=600)
    out = loop.build().invoke(_initial())
    assert out["result"] is not None
    assert "results summarised in the scratchpad" in " ".join(
        str(m.content) for m in out["messages"]
    )
    assert "echo" in (tmp_path / "pad.md").read_text()


def test_a_killed_loop_resumes_from_its_checkpoint(config, tmp_path) -> None:
    """Crash on the third model call; the resumed loop continues with the earlier
    tool turns in its history instead of starting over."""
    script = [
        ai(tool_calls=[{"name": "echo", "args": {"value": "1"}}]),
        ai(tool_calls=[{"name": "echo", "args": {"value": "2"}}]),
        ai(tool_calls=[{"name": "finish", "args": {"text": "d"}}]),
    ]
    loop = _loop(config, tmp_path, script)
    model: ScriptedChatModel = loop.model  # type: ignore[assignment]
    model.fail_on_call = 3
    saver = InMemorySaver()
    compiled = loop.build()
    compiled.checkpointer = saver
    cfg = {"configurable": {"thread_id": "t1"}}
    try:
        run_loop(compiled, _initial(), cfg, saver)
        raise AssertionError("expected the simulated crash")
    except RuntimeError:
        pass
    snapshot = compiled.get_state(cfg)
    assert snapshot.next and snapshot.values["turns"] == 2
    out = run_loop(compiled, _initial(), cfg, saver)
    assert out["result"]["args"]["text"] == "d"
    # the resumed call saw the two earlier tool turns, i.e. it did not restart
    assert sum(1 for m in model.calls[-1] if m.type == "tool") == 2
    assert out["turns"] == 2


def test_long_loops_do_not_hit_the_recursion_limit(config, tmp_path) -> None:
    """Twenty tool turns = forty-plus graph steps; LangGraph's default limit is 25."""
    script = [
        ai(tool_calls=[{"name": "echo", "args": {"value": str(i)}}]) for i in range(20)
    ]
    script.append(ai(tool_calls=[{"name": "finish", "args": {"text": "late"}}]))
    loop = _loop(config, tmp_path, script, max_turns=30)
    out = run_loop(loop.build(), _initial(), None, None, max_turns=loop.max_turns)
    assert out["result"]["args"]["text"] == "late" and out["turns"] == 20
