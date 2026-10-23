"""``GuideVoiceAgent``: the LiveKit agent for an Ally voice session.

LiveKit's pipeline runs STT → ``llm_node`` → TTS. Here ``llm_node`` is a relay:
it hands the learner's final transcript to ally-be and yields ally-be's reply
as it streams (``GuideVoiceTurns.speak``). Nothing in this process calls a
model — not for replies, not for fillers, not for anything — and none of the
roleplay agent's graph, persona or prompts is involved.

``tts_node`` is LiveKit's default except for the fixed crisis message, which is
synthesised a sentence at a time, slower, with a pause between sentences.
"""

from __future__ import annotations

from contextlib import nullcontext
from typing import Any, AsyncIterable, AsyncIterator, Optional

from livekit import rtc
from livekit.agents import Agent, llm
from livekit.agents.voice import ModelSettings

from app.core.guide.crisis import DeliveryState, SpeakingRate, silence, split_sentences
from app.core.guide.turns import GuideVoiceTurns, Spoken
from app.core.logger import get_logger

logger = get_logger(__name__)


class BackendRelayLLM(llm.LLM):
    """Stands in the session's LLM slot so LiveKit runs its STT → reply → TTS
    pipeline; ``GuideVoiceAgent.llm_node`` replaces the model call entirely,
    so ``chat`` must never be reached."""

    @property
    def model(self) -> str:
        return "ally-be"

    @property
    def provider(self) -> str:
        return "ally-be"

    def chat(self, **_: Any) -> llm.LLMStream:
        raise RuntimeError(
            "The guide voice worker never calls a model: replies come from "
            "ally-be through GuideVoiceAgent.llm_node."
        )


def latest_learner_text(chat_ctx: llm.ChatContext) -> Optional[str]:
    """The learner's message this reply answers, if the newest message is
    theirs."""
    for item in reversed(chat_ctx.items):
        if getattr(item, "type", None) != "message":
            continue
        if item.role == "user":
            return item.text_content
        if item.role == "assistant":
            return None
    return None


async def _one(text: str) -> AsyncIterator[str]:
    yield text


class GuideVoiceAgent(Agent):
    def __init__(
        self,
        turns: GuideVoiceTurns,
        delivery: DeliveryState,
        *,
        speaking_rate: Optional[SpeakingRate] = None,
        crisis_rate: float = 0.85,
        crisis_pause_s: float = 0.6,
    ) -> None:
        super().__init__(
            instructions=(
                "Relay for Ally's voice sessions: replies are written by "
                "ally-be, never by a model in this worker."
            )
        )
        self._turns = turns
        self._delivery = delivery
        self._speaking_rate = speaking_rate
        self._crisis_rate = crisis_rate
        self._crisis_pause_s = crisis_pause_s

    async def llm_node(
        self,
        chat_ctx: llm.ChatContext,
        tools: list,
        model_settings: ModelSettings,
    ) -> AsyncIterator[Spoken]:
        text = latest_learner_text(chat_ctx)
        if not text:
            return
        async for piece in self._turns.speak(text):
            yield piece

    async def tts_node(
        self, text: AsyncIterable[str], model_settings: ModelSettings
    ) -> AsyncIterator[rtc.AudioFrame]:
        # LiveKit calls this once per segment (segments are split by the
        # flushes around a crisis message). The crisis flag is set before the
        # crisis text is yielded, so it is settled by the segment's first chunk.
        chunks = text.__aiter__()
        try:
            first = await chunks.__anext__()
        except StopAsyncIteration:
            return

        async def segment() -> AsyncIterator[str]:
            yield first
            async for chunk in chunks:
                yield chunk

        if not self._delivery.crisis:
            async for frame in Agent.default.tts_node(self, segment(), model_settings):
                yield frame
            return
        async for frame in self._paced(segment(), model_settings):
            yield frame

    async def _paced(
        self, text: AsyncIterable[str], model_settings: ModelSettings
    ) -> AsyncIterator[rtc.AudioFrame]:
        """The crisis message: slower, one sentence at a time, a pause between
        sentences — and nothing else spoken inside it."""
        full = "".join([chunk async for chunk in text])
        sentences = split_sentences(full)
        logger.info("[GUIDE] speaking the fixed crisis message slowly")
        rate = self._speaking_rate
        with rate.slowed(self._crisis_rate) if rate else nullcontext(False):
            for index, sentence in enumerate(sentences):
                last: Optional[rtc.AudioFrame] = None
                async for frame in Agent.default.tts_node(
                    self, _one(sentence), model_settings
                ):
                    last = frame
                    yield frame
                if last is not None and index < len(sentences) - 1:
                    for pause in silence(
                        last.sample_rate, last.num_channels, self._crisis_pause_s
                    ):
                        yield pause
