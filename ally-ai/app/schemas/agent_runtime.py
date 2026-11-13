"""Request/response shapes for `/agent/run`, the Agents v2 runtime.

Deliberately a superset of `/knowledge-agent/answer` in both directions, so ally-be
can fall back to that endpoint (v1) with almost no mapping. The contract grows
toward the full v2 shape (contact, run_token, resume) in later chunks.
"""

from typing import Any, Dict, List, Literal, Optional

from pydantic import (
    BaseModel,
    Field,
    SecretStr,
    SerializerFunctionWrapHandler,
    field_validator,
    model_serializer,
)

from app.core.agent_runtime.schemas import TurnType
from app.core.agent_runtime.state import BotConfig
from app.schemas.knowledge_agent import (
    KnowledgeAnswerRequest,
    KnowledgeAnswerResponse,
    RetrievalMeta,
)


class AgentGateway(BaseModel):
    """ally-be's tool gateway for this run (chunk 3b). Sent only for a bot with a
    tool on; without it a run is search-only, exactly as before."""

    url: str = Field(..., max_length=500)
    #: A credential, signed by ally-be for this run alone: a SecretStr, so a repr,
    #: a validation error or a log line never shows it.
    token: SecretStr
    tools: List[str] = Field(default_factory=list, max_length=20)


class AgentRunRequest(KnowledgeAnswerRequest):
    conversation_id: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description=(
            "The conversation this message belongs to. Also the checkpointer's thread "
            "id, so every run in a conversation is stored together and can be read "
            "back later."
        ),
    )
    run_id: Optional[str] = Field(
        None, max_length=200, description="Generated (uuid4) when absent"
    )
    chatbot_id: Optional[str] = Field(
        None, max_length=200, description="Recorded with the run; not used to answer"
    )
    runtime_version: str = Field("v2", max_length=16)
    log_retrieval: bool = Field(
        True,
        description=(
            "False skips the retrieval log for this run, for a caller that has "
            "already logged the same message."
        ),
    )
    knowledge_topics: List[str] = Field(
        default_factory=list,
        max_length=50,
        description=(
            "Titles of the bot's documents, so the agent can say truthfully what it "
            "covers. Used only by the conversational agent."
        ),
    )
    decline_text: Optional[str] = Field(
        None,
        max_length=500,
        description=(
            "The bot's decline wording. The agent takes its tone and where-to-go-next "
            "from it, not its words."
        ),
    )

    gateway: Optional[AgentGateway] = Field(
        None,
        description=(
            "ally-be's tool gateway, for a bot with a tool turned on (chunk 3b). "
            "Absent: search only."
        ),
    )

    def to_bot(self) -> BotConfig:
        """The `bot` block of the run's state. It names the gateway's tools but
        never holds the gateway's URL or token: state is checkpointed."""
        bot: BotConfig = {
            "prompts": self.prompts,
            "limits": {
                "top_k": self.top_k,
                "min_similarity": self.min_similarity,
                "decline_similarity": self.decline_similarity,
                "max_passages": self.max_passages,
                "max_context_tokens": self.max_context_tokens,
                "similarity_band": self.similarity_band,
            },
            "max_answer_chars": self.max_answer_chars,
            "translate_query": self.translate_query,
            # `is not None`, not truthiness, as in the old route: an EMPTY list is
            # "this bot has no documents" and must search nothing, never everything.
            "document_ids": (
                [str(d) for d in self.document_ids]
                if self.document_ids is not None
                else None
            ),
            "persona": self.persona.model_dump() if self.persona else None,
            "answer_mode": self.answer_mode,
            "channel": self.channel,
            "audience": self.audience.model_dump(mode="json"),
            "log_retrieval": self.log_retrieval,
            "knowledge_topics": list(self.knowledge_topics),
            "decline_text": self.decline_text,
        }
        if self.gateway:
            bot["gateway_tools"] = list(self.gateway.tools)
        return bot

    @field_validator("knowledge_topics")
    @classmethod
    def _trim_topics(cls, topics: List[str]) -> List[str]:
        """Blank titles dropped; a pathological title cannot crowd the prompt."""
        return [t.strip()[:200] for t in topics if t and t.strip()]


class AgentRetrievalMeta(RetrievalMeta):
    hit_chunk_ids: List[str] = Field(
        default_factory=list,
        description=(
            "Debug only: every retrieved chunk id, best first, before selection. "
            "Not part of the /knowledge-agent/answer contract."
        ),
    )
    passage_document_ids: List[str] = Field(
        default_factory=list,
        description=(
            "Every document the agent was shown a passage from, across all of the "
            "run's searches (the fields above cover the first search only). The "
            "checkup uses it to tell a wrong decline from an honest one."
        ),
    )
    passage_chunk_ids: List[str] = Field(
        default_factory=list,
        description=(
            "Every passage the agent was shown, across all of the run's searches. "
            "The checkup's judge reads them, so a detail a decline took from them "
            "isn't taken for an invented one."
        ),
    )
    searches: int = Field(
        0, description="How many times the agent searched in this run."
    )


class TraceStep(BaseModel):
    node: str
    ms: int
    summary: str


class AgentRunResponse(KnowledgeAnswerResponse):
    retrieval: AgentRetrievalMeta
    run_id: str
    trace: List[TraceStep] = Field(default_factory=list)
    runtime: Literal["v2"] = "v2"
    turn_type: Optional[TurnType] = Field(
        None,
        description=(
            "What the conversational agent understood the message to be. A "
            "smalltalk or about_bot reply comes back as intent `answer` with no "
            "citations."
        ),
    )
    handover: bool = Field(
        False,
        description=(
            "The agent passed the chat to a person with `hand_over` (chunk 3b). The "
            "answer is empty; ally-be replies with its hand-over message."
        ),
    )

    @model_serializer(mode="wrap")
    def _handover_only_when_set(
        self, handler: SerializerFunctionWrapHandler
    ) -> Dict[str, Any]:
        """`handover` is sent only when true, so every other response is exactly
        what it was before chunk 3b."""
        data = handler(self)
        if not data.get("handover"):
            data.pop("handover", None)
        return data


# ── "How it works" (chunk 20d-2) ─────────────────────────────────────────────


class InstructionPart(BaseModel):
    """One labelled stretch of the instructions, in the order it appears."""

    layer: str
    text: str
    #: Written by the owner (business name, tone, their instructions, topics to avoid).
    owner: bool = False


class InstructionsResponse(BaseModel):
    """The instructions a run for this bot starts from, as `/agent/run` would build
    them: `full` is the text; `parts` joined are exactly `full`."""

    full: str
    parts: List[InstructionPart]
    placeholders: Dict[str, str]
    search: Dict[str, Any]


class OwnerTextCheckRequest(BaseModel):
    text: str = Field(..., max_length=8000)


class OwnerTextCheckResponse(BaseModel):
    #: `weakens_safety` when the text would weaken a safety rule (not saved).
    refused: Optional[str] = None
    #: `override_attempt` when it reads like "ignore previous instructions" (saved, with
    #: a note that it can't outrank the rules).
    warning: Optional[str] = None
