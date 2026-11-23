"""Offline fakes for the graph tests: a scripted chat model and a scripted runner."""

from __future__ import annotations

import json
from typing import Any, Iterator, Sequence

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel, Field

from bug_hunter.tools.runner import RunResult


def ai(
    content: str = "", tool_calls: list[dict] | None = None, **usage: int
) -> AIMessage:
    """An AI message with usage (defaults 100 in / 20 out) and optional tool calls."""
    calls = [
        {"name": c["name"], "args": c.get("args", {}), "id": c.get("id", f"call-{i}")}
        for i, c in enumerate(tool_calls or [])
    ]
    return AIMessage(
        content=content,
        tool_calls=calls,
        usage_metadata={
            "input_tokens": usage.get("input", 100),
            "output_tokens": usage.get("output", 20),
            "total_tokens": usage.get("input", 100) + usage.get("output", 20),
            "input_token_details": {"cache_read": usage.get("cached", 0)},
        },
        response_metadata={"model_name": usage_model(usage)},
    )


def usage_model(usage: dict) -> str:
    return str(usage.get("model", "gpt-5"))


def structured(obj: BaseModel | dict, **usage: int) -> AIMessage:
    """A message whose content is the JSON of a structured answer."""
    data = obj.model_dump() if isinstance(obj, BaseModel) else obj
    return ai(json.dumps(data), **usage)


class ScriptedChatModel(BaseChatModel):
    """Returns the scripted messages in order. ``bind_tools`` records the tool names
    and returns the same model; ``with_structured_output`` parses the next message's
    JSON content. ``fail_on_call`` raises on that (1-based) call, to simulate a kill."""

    script: list[AIMessage] = Field(default_factory=list)
    calls: list[list[BaseMessage]] = Field(default_factory=list)
    bound_tools: list[list[str]] = Field(default_factory=list)
    bound_kwargs: list[dict] = Field(default_factory=list)
    fail_on_call: int | None = None
    cursor: int = 0

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def _next(self, messages: Sequence[BaseMessage]) -> AIMessage:
        self.calls.append(list(messages))
        if self.fail_on_call is not None and len(self.calls) == self.fail_on_call:
            self.fail_on_call = None  # only once: the resumed run must get through
            raise RuntimeError("simulated crash")
        if self.cursor >= len(self.script):
            raise AssertionError(f"script exhausted after {self.cursor} calls")
        message = self.script[self.cursor]
        self.cursor += 1
        return message

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self._next(messages))])

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any):
        self.bound_tools.append([getattr(t, "name", str(t)) for t in tools])
        self.bound_kwargs.append(dict(kwargs))
        return self

    def with_structured_output(self, schema: Any, *, include_raw: bool = False, **_):
        def call(messages):
            raw = self._next(messages)
            try:
                parsed = schema.model_validate_json(raw.content)
                error = None
            except Exception as exc:  # noqa: BLE001
                parsed, error = None, exc
            if include_raw:
                return {"raw": raw, "parsed": parsed, "parsing_error": error}
            if error:
                raise error
            return parsed

        return RunnableLambda(call)


class ScriptedRunner:
    """``run_tests`` returns scripted results in order (last one repeats)."""

    def __init__(self, app: str, results: Sequence[RunResult]):
        self.app = app
        self.results = list(results)
        self.calls: list[tuple[str | None, str | None]] = []
        # per instance (class-level lists leaked between tests)
        self.suite: list[RunResult] = []
        self.suite_calls: list[str] = []
        self.format_calls: list[str] = []
        self.format_hook = None
        self.lint_result: RunResult | None = None
        self.typecheck_result: RunResult | None = None

    def run_tests(
        self, target: str | None = None, name: str | None = None
    ) -> RunResult:
        self.calls.append((target, name))
        index = min(len(self.calls) - 1, len(self.results) - 1)
        return self.results[index]

    def run_tests_command(self, command: str) -> RunResult:
        self.suite_calls.append(command)
        if self.suite:
            return self.suite.pop(0) if len(self.suite) > 1 else self.suite[0]
        return run_result(self.app, True)

    def run_format(self, command: str) -> RunResult:
        self.format_calls.append(command)
        if self.format_hook:
            self.format_hook(command)
        return run_result(self.app, True)

    def run_lint(self) -> RunResult:
        return self.lint_result or run_result(self.app, True)

    def run_typecheck(self) -> RunResult:
        return self.typecheck_result or run_result(self.app, True)


def run_result(
    app: str, passed: bool, excerpt: str = "", no_tests: bool = False, timed_out=False
) -> RunResult:
    return RunResult(
        app=app,
        kind="test",
        command="npx jest x",
        passed=passed,
        exit_code=0 if passed else 1,
        duration_s=0.5,
        failing_tests=[] if passed else ["x › fails"],
        excerpt=excerpt,
        timed_out=timed_out,
        no_tests=no_tests,
    )


def tool_messages(messages: Sequence[BaseMessage]) -> Iterator[BaseMessage]:
    return (m for m in messages if m.type == "tool")
