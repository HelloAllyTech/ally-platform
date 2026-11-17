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
    #: The generated list tools (chunk 6): each becomes a gateway tool at run time.
    definitions: List["ListToolDefinition"] = Field(default_factory=list, max_length=12)
    #: List tools the bot has on that didn't fit under the cap; named in the trace.
    omitted: List[str] = Field(default_factory=list, max_length=200)
    #: Today where the business is, for the lists section ("Saturday 14 Nov 2026,
    #: 11:58 (Asia/Kolkata, UTC+05:30)"); sent with list tools.
    today: str = Field("", max_length=120)


class ListToolDefinition(BaseModel):
    """One generated list tool (chunk 6), as ally-be builds it from a list."""

    name: str = Field(..., pattern=r"^(find|create|update)_[a-z0-9_]{1,40}$")
    description: str = Field("", max_length=2000)
    input_schema: Dict[str, Any] = Field(default_factory=dict)
    kind: Literal["find", "create", "update"]
    #: The list's name as the owner wrote it ("Slots"), for the live steps on the
    #: bot page (chunk 6b). Never shown to the model.
    list_name: str = Field("", max_length=120)
    #: A create on a list with a person or phone field (Leads, Callback requests):
    #: it saves the person's details for the team (chunk 6b).
    takes_details: bool = False

    def as_bot_definition(self) -> Dict[str, Any]:
        """The definition as the run keeps it: the 6b fields only when set, so a
        definition without them is exactly what it was before."""
        data = self.model_dump(mode="json")
        for key in ("list_name", "takes_details"):
            if not data.get(key):
                data.pop(key, None)
        return data


AgentGateway.model_rebuild()


class AgentMemory(BaseModel):
    """What the assistant knows about the person (chunk 8a), rendered by ally-be.
    Sent only when the bot's memory is on."""

    #: "m1 (12 Nov): prefers evenings", one per line; "" when there are none yet.
    lines: str = Field("", max_length=4000)
    never_store: List[str] = Field(default_factory=list, max_length=60)


class BeforeChatAnswer(BaseModel):
    """One pre-chat answer (chunk 8a)."""

    label: str = Field(..., max_length=120)
    value: str = Field(..., max_length=120)


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
    memory: Optional[AgentMemory] = Field(
        None,
        description=(
            "The person's memory lines, when the bot's memory is on (chunk 8a). "
            "Absent: the agent neither sees nor writes memory."
        ),
    )
    summary: Optional[str] = Field(
        None,
        max_length=2000,
        description="This chat's rolling summary of the messages before the last 10.",
    )
    person_name: Optional[str] = Field(
        None, max_length=80, description="The person's name, when it is known."
    )
    before_chat: List["BeforeChatAnswer"] = Field(
        default_factory=list,
        max_length=6,
        description=(
            "What they told the page before the chat (chunk 8a): its answers other "
            "than their name and contact details."
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
            # Only when there are some, so a run without list tools is today's.
            if self.gateway.definitions:
                bot["gateway_definitions"] = [
                    d.as_bot_definition() for d in self.gateway.definitions
                ]
            if self.gateway.omitted:
                bot["gateway_omitted"] = list(self.gateway.omitted)
            if self.gateway.definitions and self.gateway.today:
                bot["gateway_today"] = self.gateway.today
        # Chunk 8a: each only when present, so a run without them is today's.
        if self.memory is not None:
            bot["memory"] = self.memory.model_dump(mode="json")
        if self.summary and self.summary.strip():
            bot["summary"] = self.summary.strip()
        if self.person_name and self.person_name.strip():
            bot["person_name"] = self.person_name.strip()
        if self.before_chat:
            bot["before_chat"] = [a.model_dump() for a in self.before_chat]
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


class MemoryWrite(BaseModel):
    """One memory write the run asks for (chunk 8a). ally-be checks and applies it
    after the reply has been sent; nothing is stored by the run."""

    op: Literal["add", "replace", "done", "forget", "name"]
    section: Optional[Literal["preferences", "context", "open_items"]] = None
    text: Optional[str] = None
    #: The short id of the line it changes ("m2"), for replace, done and forget.
    id: Optional[str] = None


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

    memory_writes: List[MemoryWrite] = Field(
        default_factory=list,
        description=(
            "What the run asked to remember (chunk 8a), applied by ally-be after the "
            "reply. Sent only when there are some."
        ),
    )

    @model_serializer(mode="wrap")
    def _handover_only_when_set(
        self, handler: SerializerFunctionWrapHandler
    ) -> Dict[str, Any]:
        """`handover` and `memory_writes` are sent only when set, so every other
        response is exactly what it was before chunks 3b and 8a."""
        data = handler(self)
        if not data.get("handover"):
            data.pop("handover", None)
        if not data.get("memory_writes"):
            data.pop("memory_writes", None)
        else:
            data["memory_writes"] = [
                {k: v for k, v in write.items() if v is not None}
                for write in data["memory_writes"]
            ]
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


# --- memory, light (chunk 8a) ---


class MemoryCheckRequest(BaseModel):
    lines: List[str] = Field(..., max_length=12)
    never_store: List[str] = Field(default_factory=list, max_length=60)
    prompts: Optional[Dict[str, Any]] = None

    @field_validator("lines")
    @classmethod
    def _cap_lines(cls, lines: List[str]) -> List[str]:
        return [(line or "").strip()[:200] for line in lines]


class MemoryCheckResponse(BaseModel):
    #: One verdict per line; all false when `failed`.
    keep: List[bool] = Field(default_factory=list)
    failed: bool = False


class SummaryMessage(BaseModel):
    role: str = Field(..., max_length=16)
    content: str = Field("", max_length=4000)


class ConversationSummaryRequest(BaseModel):
    summary: Optional[str] = Field(None, max_length=2000)
    messages: List[SummaryMessage] = Field(..., max_length=200)
    #: A health, pharmacy or mental-health assistant: no clinical details.
    health: bool = False
    prompts: Optional[Dict[str, Any]] = None


class ConversationSummaryResponse(BaseModel):
    summary: str = ""
    failed: bool = False
