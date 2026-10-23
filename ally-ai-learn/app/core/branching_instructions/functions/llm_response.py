"""Function to generate LLM responses for branching instructions."""

from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.logger import get_logger
from app.llms import create_llm_client
from app.llms.base import BaseLLMClient
from app.prompts.resolver import load_template

logger = get_logger(__name__)


async def generate_llm_response(
    content: str,
    language_code: str = DEFAULT_LANGUAGE_CODE,
    llm_config: Optional[dict] = None,
    llm_client: Optional[BaseLLMClient] = None,
) -> str:
    """
    Generate an LLM response for the given content.

    This function is used to substitute <llm_response> tags in branching instructions.
    It sends the content to the LLM and returns the response text.

    Args:
        content: The prompt/content to send to the LLM
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
        llm_config: Optional LLM configuration dict with provider and model settings

    Returns:
        The LLM's response as a string

    Raises:
        Exception: If LLM invocation fails

    Example:
        >>> response = await generate_llm_response(
        ...     "What is a good response to 'How are you?'",
        ...     language_code="en-IN"
        ... )
        >>> print(response)
        "I'm doing well, thank you for asking! How can I help you today?"
    """
    if not content:
        logger.warning("Empty content provided to generate_llm_response")
        return ""

    try:
        if llm_client is None:
            llm_client = create_llm_client(
                llm_config=llm_config,
                language_code=language_code,
            )
        llm_instance = llm_client.llm_instance

        logger.debug(f"Generating LLM response for content: {content[:100]}...")

        class LLMResponse(BaseModel):
            content: str

        system_message = SystemMessage(
            content=load_template("branching/llm_response_system")
        )

        # Create user message with only the content
        user_message = HumanMessage(content=content)

        # Invoke LLM with structured messages. include_raw because the parsed
        # model alone carries no usage metadata.
        result = await llm_instance.with_structured_output(
            LLMResponse, include_raw=True
        ).ainvoke([system_message, user_message])
        if isinstance(result, dict):
            from app.core.llm_usage.emitter import emit_langchain_usage
            from app.core.llm_usage.tasks import LLMTask

            # Emitted before parsing: a parse failure still spent the tokens.
            # No explicit room: the only caller is the resolve_branching_
            # instruction graph node, where the room context var is set.
            emit_langchain_usage(
                result.get("raw"),
                task=LLMTask.BRANCHING_INSTRUCTION.value,
                llm_client=llm_client,
            )
            response = result.get("parsed")
            if response is None:
                raise ValueError(
                    f"unparseable llm_response output: {result.get('parsing_error')}"
                )
        else:
            # Defensive: some providers/wrappers may ignore include_raw.
            response = result

        logger.debug(f"LLM response generated: {response.content[:100]}...")

        return response.content

    except Exception as e:
        logger.error(f"Failed to generate LLM response: {e}")
        raise
