"""The two calls ally-be makes after a reply (chunk 8a).

- `check_lines`: on a health, pharmacy or mental-health assistant, which memory lines
  are practical and non-clinical enough to keep. ally-be drops every line when this
  fails or times out (it fails closed).
- `summarize`: folds the messages leaving the agent's 10-message window into the
  chat's running summary. On failure ally-be keeps the old summary.

Neither stores anything; both use their prompt from the Skills Store when the request
carries it.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Type, TypeVar

from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.llm.dispatch import generate_structured
from app.core.llm_usage.tasks import LLMTask
from app.exceptions.custom_exceptions import LLMInvocationFailedException
from app.prompts.resolver import get_backend_llm_overrides, load_and_format
from app.utils.logger import get_logger

logger = get_logger(__name__)

CHECK_PROMPT_PATH = "memory/check"
SUMMARY_PROMPT_PATH = "conversation/summary"
SUMMARY_MAX_CHARS = 800
NO_SUMMARY = "(none yet)"
NO_NEVER_STORE = "(nothing listed)"

T = TypeVar("T", bound=BaseModel)


class CheckVerdict(BaseModel):
    keep: List[bool] = Field(default_factory=list)


class SummaryOut(BaseModel):
    summary: str = ""


async def _call(
    path: str,
    schema: Type[T],
    task: LLMTask,
    *,
    prompts: Optional[Dict[str, Any]],
    timeout: float,
    **variables: Any,
) -> T:
    """Render the prompt and run it. A missing template is an error, never an
    unguided call."""
    prompt = load_and_format(path, prompts=prompts, **variables)
    if not prompt:
        logger.error("Memory prompt %s resolved empty", path)
        raise LLMInvocationFailedException(f"The prompt {path} is missing or empty.")
    provider, model, temperature = get_backend_llm_overrides(path, prompts)
    parsed, _meta = await generate_structured(
        schema=schema,
        prompt=prompt,
        task=task.value,
        provider=provider,
        model=model,
        temperature=temperature if temperature is not None else 0.0,
        timeout=timeout,
    )
    return parsed


async def check_lines(
    lines: Sequence[str],
    never_store: Sequence[str] = (),
    *,
    prompts: Optional[Dict[str, Any]] = None,
) -> List[bool]:
    """One verdict per line. Raises on any failure, and when the model's answer
    doesn't have one verdict per line: the caller keeps nothing then."""
    if not lines:
        return []
    numbered = "\n".join(f"{i}. {line}" for i, line in enumerate(lines, start=1))
    never = ", ".join(n.strip() for n in never_store if n and n.strip())
    verdict = await _call(
        CHECK_PROMPT_PATH,
        CheckVerdict,
        LLMTask.CHATBOT_MEMORY_CHECK,
        prompts=prompts,
        timeout=settings.AGENT_RUNTIME.MEMORY_CALL_TIMEOUT_SECONDS,
        lines=numbered,
        never_store=never or NO_NEVER_STORE,
    )
    if len(verdict.keep) != len(lines):
        raise LLMInvocationFailedException(
            "The memory check answered for the wrong lines."
        )
    return list(verdict.keep)


def _render_messages(messages: Sequence[Dict[str, str]]) -> str:
    out: List[str] = []
    for message in messages:
        role = (message.get("role") or "").strip().lower()
        text = " ".join((message.get("content") or "").split())
        if not text:
            continue
        speaker = "Person" if role in ("user", "human", "person") else "Assistant"
        out.append(f"{speaker}: {text}")
    return "\n".join(out)


async def summarize(
    summary: Optional[str],
    messages: Sequence[Dict[str, str]],
    *,
    health: bool = False,
    prompts: Optional[Dict[str, Any]] = None,
) -> str:
    """The new summary, at most 800 characters. Raises on failure."""
    rendered = _render_messages(messages)
    if not rendered:
        return (summary or "").strip()
    out = await _call(
        SUMMARY_PROMPT_PATH,
        SummaryOut,
        LLMTask.CHATBOT_CONVERSATION_SUMMARY,
        prompts=prompts,
        timeout=settings.AGENT_RUNTIME.MEMORY_CALL_TIMEOUT_SECONDS * 3,
        summary=(summary or "").strip() or NO_SUMMARY,
        messages=rendered,
        max_chars=SUMMARY_MAX_CHARS,
        health_service="yes" if health else "no",
    )
    text = " ".join(out.summary.split())
    if not text:
        raise LLMInvocationFailedException("The summary came back empty.")
    if len(text) > SUMMARY_MAX_CHARS:
        text = text[:SUMMARY_MAX_CHARS].rsplit(" ", 1)[0].rstrip() + "…"
    return text
