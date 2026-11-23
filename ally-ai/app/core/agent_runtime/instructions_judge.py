"""The model judge on owner-written text, on Apply (the second pass after the regex
`check_owner_text`). It reads the text against a fixed rule list and says whether it
conflicts, with a short reason in English and Hindi. ally-be fails closed on failure.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

from pydantic import BaseModel

from app.core.config import settings
from app.core.llm.dispatch import generate_structured
from app.core.llm_usage.tasks import LLMTask
from app.exceptions.custom_exceptions import LLMInvocationFailedException
from app.prompts.resolver import get_backend_llm_overrides, load_and_format
from app.utils.logger import get_logger

logger = get_logger(__name__)

PROMPT_PATH = "agent/instructions_judge"


class JudgeVerdict(BaseModel):
    conflict: bool = True
    rule: Optional[int] = None
    reason_en: str = ""
    reason_hi: str = ""


async def judge_owner_text(
    text: str,
    rules: Sequence[str],
    *,
    prompts: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """The verdict as a dict. Raises on any failure; the endpoint turns that into
    `failed`."""
    numbered = "\n".join(f"{i}. {r}" for i, r in enumerate(rules, start=1))
    prompt = load_and_format(PROMPT_PATH, prompts=prompts, text=text, rules=numbered)
    if not prompt:
        raise LLMInvocationFailedException(f"The prompt {PROMPT_PATH} is missing.")
    provider, model, temperature = get_backend_llm_overrides(PROMPT_PATH, prompts)
    verdict, _meta = await generate_structured(
        schema=JudgeVerdict,
        prompt=prompt,
        task=LLMTask.APPLY_SAFETY_JUDGE.value,
        provider=provider,
        model=model,
        temperature=temperature if temperature is not None else 0.0,
        timeout=settings.AGENT_RUNTIME.MEMORY_CALL_TIMEOUT_SECONDS * 2,
    )
    rule = verdict.rule if verdict.rule and 1 <= verdict.rule <= len(rules) else None
    return {
        "conflict": verdict.conflict,
        "rule": rule if verdict.conflict else None,
        "reason_en": verdict.reason_en.strip() or None,
        "reason_hi": verdict.reason_hi.strip() or None,
    }
