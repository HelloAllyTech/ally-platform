"""A scripted tool-calling chat model and a fake gateway for Ask Ally tests."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from pydantic import Field

from app.core.ask_ally.schemas import AskAllyRequest

PRICES = {"gemini-2.5-flash": {"input_per_m": 0.3, "output_per_m": 2.5}}


def ai(
    text: str = "", calls: Optional[List[Dict[str, Any]]] = None, tokens=(1000, 100)
):
    return AIMessage(
        content=text,
        tool_calls=[
            {"name": c["name"], "args": c.get("args", {}), "id": c.get("id", f"c{i}")}
            for i, c in enumerate(calls or [])
        ],
        usage_metadata={
            "input_tokens": tokens[0],
            "output_tokens": tokens[1],
            "total_tokens": sum(tokens),
        },
    )


class ScriptedModel(BaseChatModel):
    """Answers each pass with the next scripted message (or raises it), and
    records the tool_choice and messages each pass was called with."""

    script: List[Any] = Field(default_factory=list)
    calls: List[Dict[str, Any]] = Field(default_factory=list)
    bound: Dict[str, Any] = Field(default_factory=dict)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):
        clone = self.model_copy()
        clone.bound = {
            "tools": [getattr(t, "name", t) for t in tools],
            "tool_choice": tool_choice,
        }
        clone.script = self.script
        clone.calls = self.calls
        return clone

    def _next(self, messages: List[BaseMessage]) -> AIMessage:
        self.calls.append(
            {"tool_choice": self.bound.get("tool_choice"), "messages": list(messages)}
        )
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self._next(messages))])

    async def _astream(
        self,
        messages,
        stop=None,
        run_manager: Optional[AsyncCallbackManagerForLLMRun] = None,
        **kwargs,
    ):
        msg = self._next(messages)
        words = msg.content.split(" ") if msg.content else []
        for i, w in enumerate(words):
            piece = w if i == len(words) - 1 else w + " "
            chunk = ChatGenerationChunk(message=AIMessageChunk(content=piece))
            if run_manager:
                await run_manager.on_llm_new_token(piece, chunk=chunk)
            yield chunk
        yield ChatGenerationChunk(
            message=AIMessageChunk(
                content="",
                tool_calls=msg.tool_calls,
                usage_metadata=msg.usage_metadata,
                chunk_position="last",
            )
        )


class FakeGateway:
    def __init__(self, answers: Optional[Dict[str, Any]] = None) -> None:
        self.answers = answers or {}
        self.calls: List[Dict[str, Any]] = []
        self.closed = False

    async def call(self, tool: str, body: Dict[str, Any]) -> Dict[str, Any]:
        self.calls.append({"tool": tool, "body": body})
        answer = self.answers.get(tool, {})
        if isinstance(answer, Exception):
            raise answer
        return answer

    async def aclose(self) -> None:
        self.closed = True


def request(**over: Any) -> AskAllyRequest:
    body = {
        "run_id": "run-1",
        "scenario_session_id": "sess-1",
        "chat_id": "chat-1",
        "tenant_id": "t1",
        "reply": {"provider": "gemini", "model": "gemini-2.5-flash", "maxTokens": 900},
        "prices": PRICES,
        "system": "REPLY PROMPT\nDEBRIEF: {}",
        "history": [
            {"role": "user", "content": "earlier question"},
            {"role": "assistant", "content": "earlier answer"},
        ],
        "message": "How should I ask about safety?",
        "run_token": "tok",
        "gateway_url": "http://be/api/v1/internal/debrief",
    }
    body.update(over)
    return AskAllyRequest.model_validate(body)
