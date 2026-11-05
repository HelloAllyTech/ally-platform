"""Request/response shapes for `/agent/run`, the Agents v2 runtime.

Deliberately a superset of `/knowledge-agent/answer` in both directions, so ally-be
can switch a bot between the two endpoints with almost no mapping (chunk 2). The
contract grows toward the full v2 shape (contact, features, run_token, resume) in
later chunks.
"""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_serializer

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
            "False skips the retrieval log for this run. ally-be sends false when it "
            "runs a bot in shadow beside /knowledge-agent/answer, which already logged "
            "the same message."
        ),
    )
    features: Dict[str, bool] = Field(
        default_factory=dict,
        description=(
            "The bot's feature flags. `agent: true` runs the conversational agent "
            "(contextualise, tools, check); absent or false runs the parity graph."
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
    turn_type: Optional[Literal["smalltalk", "about_bot", "question", "unclear"]] = (
        Field(
            None,
            description=(
                "What the conversational agent understood the message to be. None "
                "when `features.agent` is off. A smalltalk or about_bot reply comes "
                "back as intent `answer` with no citations."
            ),
        )
    )

    @model_serializer(mode="wrap")
    def _omit_turn_type_when_off(self, handler):
        """With the agent off, the response is exactly the chunk 1 shape."""
        data = handler(self)
        if data.get("turn_type") is None:
            data.pop("turn_type", None)
        return data
