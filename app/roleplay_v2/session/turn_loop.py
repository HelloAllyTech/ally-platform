"""Text-mode turn loop for roleplay v2 (rehearsal harness + demo REPL).

One RoleplayTurnEngine owns a full session: the runtime state store, the
Actor engine, and (optionally) the Director. The voice worker does NOT use
this class — it wires the same components onto a LiveKit AgentSession — but
both paths share identical Actor/Director semantics, which is what makes a
rehearsal predictive of live behavior.

Director coupling per turn:
- rehearsal AWAITS the Director (``await_director=True``) so every turn is
  judged before the next trainee utterance;
- voice fire-and-forgets (the worker calls ``on_turn_committed``), so a slow
  Director can only miss a turn, never add speech latency.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Optional

from langchain_core.messages import AIMessage, HumanMessage

from app.core.logger import get_logger
from app.roleplay_v2.actor.engine import ActorEngine
from app.roleplay_v2.director.emitters import DirectorEmitter
from app.roleplay_v2.director.schemas import DirectorVerdict
from app.roleplay_v2.director.service import DirectorService
from app.roleplay_v2.spec.models import ScenarioSpec
from app.roleplay_v2.spec.runtime_state import RuntimeSessionState, RuntimeStateStore

logger = get_logger(__name__)


@dataclass
class TurnResult:
    """Outcome of one trainee turn (or the opening)."""

    actor_text: str
    verdict: Optional[DirectorVerdict]
    state_snapshot: RuntimeSessionState


class RoleplayTurnEngine:
    """Drives a complete text-mode roleplay session."""

    def __init__(
        self,
        spec: ScenarioSpec,
        actor_llm: Any,
        director_llm: Any = None,
        clock: Any = None,
        *,
        room_id: str = "roleplay-v2-text",
        emitter: Optional[DirectorEmitter] = None,
        director_timeout_s: Optional[float] = None,
        prompt_data: Any = None,
    ) -> None:
        self.spec = spec
        self.state_store = RuntimeStateStore(spec)
        self.emitter = emitter or DirectorEmitter(room_id, room=None, enable_sqs=False)
        self.actor = ActorEngine(
            spec, self.state_store, actor_llm, prompt_data=prompt_data
        )
        self.director: Optional[DirectorService] = None
        if director_llm is not None:
            self.director = DirectorService(
                spec,
                self.state_store,
                director_llm,
                self.emitter,
                session_clock=clock,
                timeout_s=director_timeout_s,
                prompt_data=prompt_data,
            )
        # LangChain message history from the CLIENT's perspective:
        # AIMessage = client (actor), HumanMessage = trainee.
        self.history: List[Any] = []

    async def opening(self) -> TurnResult:
        """The client's first line: scripted openingStatement, else generated."""
        if self.spec.opening_statement:
            text = self.spec.opening_statement
        else:
            text = await self.actor.generate(self.history)
        self.history.append(AIMessage(content=text))
        return TurnResult(
            actor_text=text,
            verdict=None,
            state_snapshot=await self.state_store.snapshot(),
        )

    async def trainee_turn(self, text: str, await_director: bool = True) -> TurnResult:
        """Process one trainee utterance → actor reply (+ optional verdict)."""
        snapshot = await self.state_store.begin_turn()
        turn_index = snapshot.turn_index
        self.history.append(HumanMessage(content=text))

        actor_text = await self.actor.generate(self.history, snapshot=snapshot)
        self.history.append(AIMessage(content=actor_text))

        verdict: Optional[DirectorVerdict] = None
        if self.director is not None:
            if await_director:
                verdict = await self.director.run_turn(turn_index, text, actor_text)
            else:
                self.director.on_turn_committed(turn_index, text, actor_text)

        return TurnResult(
            actor_text=actor_text,
            verdict=verdict,
            state_snapshot=await self.state_store.snapshot(),
        )

    async def close(self) -> None:
        """Flush any in-flight Director work (fire-and-forget mode)."""
        if self.director is not None:
            await self.director.flush()
