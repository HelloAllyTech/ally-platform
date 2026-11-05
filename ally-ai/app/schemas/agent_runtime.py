"""Request/response shapes for `/agent/run`, the Agents v2 runtime.

Deliberately a superset of `/knowledge-agent/answer` in both directions, so ally-be
can switch a bot between the two endpoints with almost no mapping (chunk 2). The
contract grows toward the full v2 shape (contact, features, run_token, resume) in
later chunks.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

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
