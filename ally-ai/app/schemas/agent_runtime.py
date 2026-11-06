"""Request/response shapes for `/agent/run`, the Agents v2 runtime.

Deliberately a superset of `/knowledge-agent/answer` in both directions, so ally-be
can fall back to that endpoint (v1) with almost no mapping. The contract grows
toward the full v2 shape (contact, run_token, resume) in later chunks.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.core.agent_runtime.schemas import TurnType
from app.core.agent_runtime.state import BotConfig
from app.schemas.knowledge_agent import (
    KnowledgeAnswerRequest,
    KnowledgeAnswerResponse,
    RetrievalMeta,
)


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

    def to_bot(self) -> BotConfig:
        """The `bot` block of the run's state."""
        return {
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
