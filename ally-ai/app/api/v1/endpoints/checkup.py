"""Checkup grader (chunk 20a-2): one verdict per question.

ally-be runs each checkup question through its real engine and posts the case with
what happened. The same grader serves the Checkup, the eval suites and the
scorecard, so their numbers agree. Nothing is stored here.
"""

import asyncio

from fastapi import APIRouter, Depends

from app.api.v1.endpoints.knowledge_agent import knowledge_errors
from app.core.checkup.grader import grade as grade_case
from app.core.checkup.grader import source_chunk_ids, source_texts
from app.core.checkup.questions import write_questions
from app.core.dependencies import get_knowledge_agent_service
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.schemas.checkup import (
    GradeRequest,
    GradeResponse,
    QuestionsRequest,
    QuestionsResponse,
)

router = APIRouter()


@router.post("/grade", response_model=GradeResponse, tags=["checkup"])
async def grade(
    payload: GradeRequest,
    service: KnowledgeAgentService = Depends(get_knowledge_agent_service),
):
    """
    Grade one reply: automatic checks first (answered, declined or crisis-only;
    cited; no markdown), then one judge call for meaning when the case needs it,
    reading the text of the passages the run retrieved.
    A judge that can't run never turns into a pass: the reason says so.
    """
    with knowledge_errors("Unexpected error grading a checkup question"):
        # The judge reads what the passages the run retrieved say (cited ones
        # first), so a detail taken from them is never taken for an invented one.
        chunk_ids = source_chunk_ids(payload.observed)
        found = await asyncio.gather(
            *(service.chunk_service.get(chunk_id) for chunk_id in chunk_ids)
        )
        return await grade_case(
            payload.case,
            payload.observed,
            use_judge=payload.judge,
            prompts=payload.prompts,
            sources=source_texts(
                [
                    *(p for p in found if p),
                    *(
                        {"document_title": title, "text": text}
                        for title, text in (
                            ("When it doesn't know", payload.observed.decline_text),
                            ("The assistant's own setup", payload.observed.about),
                        )
                        if text
                    ),
                ]
            ),
        )


@router.post("/questions", response_model=QuestionsResponse, tags=["checkup"])
async def questions(payload: QuestionsRequest):
    """
    Checkup questions from a business's learned details. Each keeps the ids of the
    details that answer it, so ally-be can store them as the question's expected
    facts and source; a question naming a detail it wasn't given is dropped.
    """
    with knowledge_errors("Unexpected error writing checkup questions"):
        return await write_questions(payload)
