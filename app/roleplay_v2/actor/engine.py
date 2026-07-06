"""ActorEngine — transport-agnostic core of the v2 persona.

Builds the layered message list and generates replies. Deliberately has NO
LiveKit imports: the same engine drives the voice worker (via the LangGraph
adapter in graph.py), the rehearsal harness, and the demo REPL.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.logger import get_logger
from app.roleplay_v2.actor.prompt_compiler import (
    compile_static_prefix,
    compile_turn_card,
)
from app.roleplay_v2.actor.retrieval.persona_bible import (
    DEFAULT_MAX_CHUNK_CHARS,
    select_chunks,
)
from app.roleplay_v2.spec.models import ScenarioSpec
from app.roleplay_v2.spec.runtime_state import RuntimeSessionState, RuntimeStateStore

logger = get_logger(__name__)


@dataclass
class PreparedTurn:
    """Everything the caller needs from one prompt compilation."""

    messages: List[Any]
    snapshot: RuntimeSessionState
    prompt_compile_ms: float


class ActorEngine:
    """Compiles prompts and generates in-character replies.

    Args:
        spec: The validated scenario spec.
        state_store: Shared runtime state (written by the Director).
        llm: A LangChain chat model (``.ainvoke(messages)`` → AIMessage).
            The voice worker passes ``create_llm_client(...).llm_instance``;
            tests pass a scripted fake.
        retriever: Chunk selector (defaults to persona_bible.select_chunks).
        audio_tag_instructions: Optional inline-audio-tag guidance, appended
            statically to the prefix when the TTS provider supports tags.
        prompt_data: Optional backend prompts dict (dashboard overrides).
    """

    def __init__(
        self,
        spec: ScenarioSpec,
        state_store: RuntimeStateStore,
        llm: Any,
        *,
        retriever=select_chunks,
        audio_tag_instructions: Optional[str] = None,
        prompt_data=None,
        max_chunk_chars: int = DEFAULT_MAX_CHUNK_CHARS,
    ) -> None:
        self.spec = spec
        self.state_store = state_store
        self.llm = llm
        self._retriever = retriever
        self._prompt_data = prompt_data
        self._max_chunk_chars = max_chunk_chars
        # Compiled once; byte-stable for the whole session (prompt caching).
        self._static_prefix = compile_static_prefix(
            spec,
            audio_tag_instructions=audio_tag_instructions,
            prompt_data=prompt_data,
        )

    @property
    def static_prefix(self) -> str:
        return self._static_prefix

    @staticmethod
    def _last_user_text(history: List[Any]) -> str:
        for message in reversed(history):
            if isinstance(message, HumanMessage):
                content = message.content
                return content if isinstance(content, str) else str(content)
        return ""

    async def prepare(
        self,
        history: List[Any],
        snapshot: Optional[RuntimeSessionState] = None,
    ) -> PreparedTurn:
        """Compile this turn's message list.

        ``snapshot`` lets an orchestrator (turn loop / graph) pin the exact
        state the turn should see; when omitted, a fresh snapshot is taken.
        """
        started = time.perf_counter()
        if snapshot is None:
            snapshot = await self.state_store.snapshot()

        chunks = self._retriever(
            self.spec,
            snapshot.retrieve_topics,
            self._last_user_text(history),
            self._max_chunk_chars,
        )
        turn_card = compile_turn_card(
            self.spec, snapshot, chunks, prompt_data=self._prompt_data
        )
        messages = [
            SystemMessage(content=self._static_prefix),
            *history,
            SystemMessage(content=turn_card),
        ]
        prompt_compile_ms = (time.perf_counter() - started) * 1000.0
        return PreparedTurn(
            messages=messages,
            snapshot=snapshot,
            prompt_compile_ms=prompt_compile_ms,
        )

    async def build_messages(
        self,
        history: List[Any],
        snapshot: Optional[RuntimeSessionState] = None,
    ) -> List[Any]:
        """[SystemMessage(static), *history, SystemMessage(turn_card)]."""
        prepared = await self.prepare(history, snapshot=snapshot)
        return prepared.messages

    async def generate(
        self,
        history: List[Any],
        snapshot: Optional[RuntimeSessionState] = None,
    ) -> str:
        """Text-mode generation (rehearsal / demo): returns the reply text."""
        prepared = await self.prepare(history, snapshot=snapshot)
        response = await self.llm.ainvoke(prepared.messages)
        content = getattr(response, "content", response)
        return content if isinstance(content, str) else str(content)
