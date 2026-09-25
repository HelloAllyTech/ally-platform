"""Function to generate chat summary from conversation state."""

from typing import List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel

from app.core.branching_instructions.constants import ReservedBranchingVariable
from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.logger import get_logger
from app.llms import create_llm_client
from app.llms.base import BaseLLMClient
from app.prompts.resolver import load_template

logger = get_logger(__name__)


async def generate_chat_summary(
    messages: List[BaseMessage],
    language_code: str = DEFAULT_LANGUAGE_CODE,
    llm_config: Optional[dict] = None,
    llm_client: Optional[BaseLLMClient] = None,
) -> str:
    """
    Generate a concise summary of the conversation using an LLM.

    Args:
        messages: List of message objects (BaseMessage)
        language_code: BCP 47 language code
        llm_config: Optional LLM configuration dict

    Returns:
        String summary of the conversation, or fallback text if failed.
    """
    if not messages:
        return "No conversation history available."

    try:
        if llm_client is None:
            llm_client = create_llm_client(
                llm_config=llm_config,
                language_code=language_code,
            )
        llm_instance = llm_client.llm_instance

        # Specific definition for structured output
        class ChatSummaryResponse(BaseModel):
            summary: str

        # Format history into a readable script format
        conversation_lines = []
        for msg in messages:
            role_label = "UNKNOWN"

            # Map classes to specific Domain Roles
            if isinstance(msg, HumanMessage):
                role_label = "COUNSELLOR"
            elif isinstance(msg, AIMessage):
                # Using 'CLIENT' here ensures the LLM understands the summary context
                role_label = "YOU"
            elif isinstance(msg, SystemMessage):
                continue

            content = getattr(msg, "content", str(msg))
            conversation_lines.append(f"{role_label}: {content}")

        conversation_text = "\n".join(conversation_lines)

        logger.debug("Generating chat summary...")

        # Invoke LLM with structured output. include_raw because the parsed
        # model alone carries no usage metadata.
        result = await llm_instance.with_structured_output(
            ChatSummaryResponse, include_raw=True
        ).ainvoke(
            [
                SystemMessage(content=load_template("branching/chat_summary_system")),
                HumanMessage(content=f"Conversation History:\n\n{conversation_text}"),
            ]
        )
        if isinstance(result, dict):
            from app.core.llm_usage.emitter import emit_langchain_usage
            from app.core.llm_usage.tasks import LLMTask

            # Emitted before parsing: a parse failure still spent the tokens.
            # No explicit room: the only caller is the resolve_branching_
            # instruction graph node, where the room context var is set.
            emit_langchain_usage(
                result.get("raw"),
                task=LLMTask.BRANCHING_CHAT_SUMMARY.value,
                llm_client=llm_client,
            )
            response = result.get("parsed")
            if response is None:
                raise ValueError(
                    f"unparseable chat summary: {result.get('parsing_error')}"
                )
        else:
            # Defensive: some providers/wrappers may ignore include_raw.
            response = result

        logger.debug("Chat summary generated successfully.")
        return response.summary

    except Exception as e:
        logger.error(f"Failed to generate chat summary: {e}")
        # Graceful fallback
        return "Conversation summary currently unavailable."


async def resolve_chat_summary(
    content: str,
    messages: List[BaseMessage],
    language_code: str = DEFAULT_LANGUAGE_CODE,
    llm_config: Optional[dict] = None,
    llm_client: Optional[BaseLLMClient] = None,
) -> str:
    """
    Specific logic to replace the <chat_summary> tag.

    Args:
        content: The original instruction content containing the tag.
        messages: The chat history.
        language_code: The language code for the LLM.
        llm_config: The configuration for the LLM.

    Returns:
        The content string with the tag replaced by the summary.
    """
    # 1. Check if the tag exists in the content
    tag_enum = ReservedBranchingVariable.CHAT_SUMMARY

    logger.debug(f"Detected {tag_enum.value} tag. Resolving summary...")

    # 2. Generate the summary
    summary = await generate_chat_summary(
        messages=messages,
        language_code=language_code,
        llm_config=llm_config,
        llm_client=llm_client,
    )

    # 3. Perform replacement
    tag_to_replace = f"<{tag_enum.value}>"
    if tag_to_replace in content:
        logger.debug(
            f"Substituted {tag_to_replace} with summary length: {len(summary)}"
        )
        return content.replace(tag_to_replace, summary)

    return content
