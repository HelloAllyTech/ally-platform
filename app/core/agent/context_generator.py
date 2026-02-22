import json
import logging
import re
from typing import Tuple

from langchain_core.messages import HumanMessage

from app.core.scenario.base import PromptData
from app.llms import BaseLLMClient
from app.prompts.manager import prompt_manager
from app.prompts.resolver import resolve_template

logger = logging.getLogger(__name__)

# Searchable log prefix for AI-generated prompt components (grep: SIMULATION_PROMPT)
LOG_PREFIX = "[SIMULATION_PROMPT]"


def _parse_response(response_text: str) -> Tuple[str, str]:
    """Parse LLM response. Expects JSON with cultural_context and speaking_style."""
    text = response_text.strip()

    # Strip markdown code blocks if present
    if "```" in text:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if match:
            text = match.group(1).strip()

    try:
        data = json.loads(text)
        return (
            data.get("cultural_context", "").strip(),
            data.get("speaking_style", "").strip(),
        )
    except json.JSONDecodeError as e:
        logger.warning("Context generation: JSON parse failed: %s", e)
        return "", ""


async def generate_cultural_context(
    prompt_data: PromptData, language_code: str, llm_client: BaseLLMClient
) -> Tuple[str, str]:
    """
    Generates cultural context and speaking style if they are missing from prompt_data.

    Args:
        prompt_data: The current prompt data containing character details.
        language_code: The BCP-47 language code (e.g., 'en-IN', 'hi-IN').
        llm_client: The LLM client to use for generation.

    Returns:
        A tuple of (cultural_context, speaking_style).
        If values already exist in prompt_data, they are returned as-is.
    """
    cultural_context = prompt_data.cultural_context
    speaking_style = prompt_data.speaking_style

    if cultural_context and speaking_style:
        logger.info(
            "%s AI_GENERATED skipped (using existing): cultural_context=%s, "
            "speaking_style=%s",
            LOG_PREFIX,
            bool(cultural_context),
            bool(speaking_style),
        )
        return cultural_context, speaking_style

    if not llm_client:
        logger.warning("No LLM client provided for context generation. Using defaults.")
        return cultural_context or "", speaking_style or ""

    try:
        backend_prompts = getattr(prompt_data, "prompts", None)
        template = (
            resolve_template("context_generation_system_prompt", backend_prompts)
            or resolve_template("ally_ai_learn_context_generation", backend_prompts)
            or prompt_manager.get_template("system", "context_generation_prompt")
        )

        prompt = template.format(
            name=prompt_data.name,
            age=prompt_data.age,
            gender=prompt_data.gender,
            location=prompt_data.current_location,
            profession=prompt_data.profession or "",
            language_code=language_code,
        )

        logger.info("Context Generation Prompt:\n%s", prompt)

        messages = [HumanMessage(content=prompt)]

        response = await llm_client.achat(messages)
        response_text = response.content.strip()
        logger.info("Context Generation Raw Response: %s", response_text)

        generated_cultural, generated_style = _parse_response(response_text)

        if not cultural_context:
            cultural_context = generated_cultural
        if not speaking_style:
            speaking_style = generated_style

        def _trunc(s):
            return (s[:200] + "...") if s and len(s) > 200 else (s or "")

        logger.info(
            "%s AI_GENERATED cultural_context: %s",
            LOG_PREFIX,
            _trunc(cultural_context),
        )
        logger.info(
            "%s AI_GENERATED speaking_style: %s",
            LOG_PREFIX,
            _trunc(speaking_style),
        )
        return cultural_context, speaking_style

    except Exception as e:
        logger.error("Failed to generate cultural context: %s", e)
        return cultural_context or "", speaking_style or ""
