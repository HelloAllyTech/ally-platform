"""Checkup questions from what we learned about a business (chunk 20a-2).

The model only phrases the question. Which details answer it, and therefore what a
good reply must say and where it comes from, stays with code: a question that names a
detail it wasn't given, or none, is dropped and counted.
"""

from __future__ import annotations

import re
from typing import List

from app.core.llm.dispatch import generate_structured
from app.core.llm_usage.tasks import LLMTask
from app.exceptions.custom_exceptions import LLMInvocationFailedException
from app.prompts.resolver import get_backend_llm_overrides, load_and_format
from app.schemas.checkup import (
    QuestionsOut,
    QuestionsRequest,
    QuestionsResponse,
    WrittenQuestion,
)

PROMPT = "checkup/questions"
MAX_QUESTION_CHARS = 200


def _format_facts(request: QuestionsRequest) -> str:
    return "\n".join(
        f"- [{fact.id}] ({fact.section or 'about'}) {' '.join(fact.text.split())}"
        for fact in request.facts
    )


def _key(question: str) -> str:
    """A question as two questions compare: case, spacing and punctuation ignored."""
    return " ".join(re.sub(r"[^\w\s]", " ", question.lower()).split())


def keep_grounded(
    request: QuestionsRequest, written: List[WrittenQuestion]
) -> QuestionsResponse:
    known = {fact.id for fact in request.facts}
    kept: List[WrittenQuestion] = []
    # Questions already asked count as seen, so a suggestion is always new.
    seen: set[str] = {_key(q) for q in request.exclude}
    dropped = 0
    for item in written:
        question = " ".join(item.question.split())[:MAX_QUESTION_CHARS]
        ids = [i for i in dict.fromkeys(item.fact_ids) if i]
        if not question or not ids or any(i not in known for i in ids):
            dropped += 1
            continue
        key = _key(question)
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        kept.append(WrittenQuestion(question=question, fact_ids=ids[:2]))
    return QuestionsResponse(questions=kept[: request.count], dropped=dropped)


async def write_questions(request: QuestionsRequest) -> QuestionsResponse:
    if not request.facts:
        return QuestionsResponse(questions=[], dropped=0)
    prompt = load_and_format(
        PROMPT,
        prompts=request.prompts,
        audience=request.audience or "clients",
        business=request.business,
        facts=_format_facts(request),
        # With questions to leave out, ask for more so `count` new ones survive.
        count=str(min(20, request.count + len(request.exclude))),
        language=request.language or "en",
    )
    if not prompt:
        raise LLMInvocationFailedException(f"The prompt {PROMPT} is missing or empty.")
    provider, model, temperature = get_backend_llm_overrides(PROMPT, request.prompts)
    out, _meta = await generate_structured(
        schema=QuestionsOut,
        prompt=prompt,
        task=LLMTask.CHECKUP_QUESTIONS.value,
        provider=provider,
        model=model,
        temperature=temperature if temperature is not None else 0.0,
        # Uncapped: a reasoning model's hidden reasoning counts against the cap, and
        # 2,048 ran out before the questions were written (as with the builder).
        max_tokens=None,
    )
    return keep_grounded(request, out.questions)
