import logging
from typing import Tuple

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.scenario.base import PromptData
from app.llms import BaseLLMClient
from app.prompts.manager import prompt_manager
from app.prompts.resolver import resolve_template

logger = logging.getLogger(__name__)


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
    # Use existing values if present for context/style
    cultural_context = prompt_data.cultural_context
    speaking_style = prompt_data.speaking_style

    if cultural_context and speaking_style:
        return cultural_context, speaking_style

    if not llm_client:
        logger.warning("No LLM client provided for context generation. Using defaults.")
        return cultural_context or "", speaking_style or ""

    try:
        # Determine age category for specific prompting
        age = prompt_data.age
        is_young = False
        try:
            # Handle "16" or "16 years"
            age_str = str(age).lower().replace("years", "").replace("year", "").strip()
            age_int = int(age_str.split()[0])
            if age_int < 35:
                is_young = True
        except (ValueError, IndexError):
            # Fallback if age isn't a parseable number
            pass

        # Determine language family
        lang_lower = language_code.lower()
        is_indian = any(
            code in lang_lower
            for code in ["hi", "ml", "ta", "te", "kn", "bn", "gu", "pa", "ur", "en-in"]
        )

        # Build Style Instruction
        style_instruction = []

        # Universal Rule: Spoken Grammar
        style_instruction.append(
            "- **CRITICAL (ALL LANGUAGES):** Use 'Spoken Grammar' "
            "(incomplete sentences, repetition, dropping pronouns, 'messy' thoughts) "
            "instead of perfect 'Written/Textbook Grammar'."
        )
        style_instruction.append(
            "- **Emotional State:** The character is DISTRESSED. Their speech "
            "should be fragmented, repetitive, or confused. NOT perfectly articulate."
        )

        if is_indian:
            style_instruction.append(
                "- **Indian Language Rule:** Do NOT use formal/bookish words "
                "(e.g., avoid 'samvadikkan', use 'samsarikkan'). "
                "Use common, everyday words."
            )

            code_mix_term = "Code-Mixing"
            if "ml" in lang_lower:
                code_mix_term = "Manglish (Malayalam + English)"
            elif "hi" in lang_lower:
                code_mix_term = "Hinglish (Hindi + English)"
            elif "ta" in lang_lower:
                code_mix_term = "Tanglish (Tamil + English)"

            # Universal Rule for Indian Languages (All Ages)
            style_instruction.append(
                "- **Anti-Textbook Principle:** Detect and avoid 'Low Frequency' "
                "formal words (textbook vocabulary). Swap with common English terms "
                "or colloquial equivalents. If a native word sounds 'written' or "
                "'formal', DISCARD it and use English."
            )
            style_instruction.append(
                "- **Category Mandate:** For domains like **Education (Exam, Result, "
                "Study), Emotions (Sad, Scared, Happy), Technology, and Career**, "
                "strictly use English terminology."
            )
            style_instruction.append(
                "- **Vocabulary Rule:** If a word has a common English equivalent "
                "used in daily life (e.g. 'Bus', 'Phone', 'Exam', 'Problem'), "
                "YOU MUST USE THE ENGLISH WORD. Do not use the native translation."
            )

            if is_young:
                young_msg = (
                    f"- **Young Character (Gen Z):** MUST use heavy **{code_mix_term}**."  # noqa: E501
                    " Mix English grammar/structure with native vocabulary "
                    "('Manglish/Hinglish' style). Use fillers like 'actually', "
                    "'like', 'scene'."
                )
                style_instruction.append(young_msg)
            else:
                style_instruction.append(
                    "- **Older Character:** Use respectful but natural spoken "
                    "language. Casual English mixing is allowed but avoid heavy slang."
                )

        style_instruction_str = "\n".join(style_instruction)

        # Prepare content creation prompt
        user_prompt = f"""
        Character Profile:
        Name: {prompt_data.name}
        Age: {prompt_data.age}
        Gender: {prompt_data.gender}
        Location: {prompt_data.current_location}
        Profession: {prompt_data.profession}
        Target Language Code: {language_code}

        Tasks:
        1. Generate Cultural Context: A brief description of the setting and cultural
           background implied by the location and profile.
        2. Generate Speaking Style: A brief instruction on how this person would speak
           in the target language.

        **Specific Style Constraints:**
        {style_instruction_str}
        """

        logger.info(f"Context Generation Prompt:\n{user_prompt}")

        backend_prompts = getattr(prompt_data, "prompts", None)
        context_prompt = (
            resolve_template("context_generation_system_prompt", backend_prompts)
            or resolve_template("ally_ai_learn_context_generation", backend_prompts)
            or prompt_manager.get_template("system", "context_generation_system_prompt")
        )

        messages = [
            SystemMessage(content=context_prompt),
            HumanMessage(content=user_prompt),
        ]

        response = await llm_client.achat(messages)
        response_text = response.content.strip()
        logger.info(f"Context Generation Raw Response: {response_text}")

        lines = response_text.split("\n")

        # Parse output loosely
        buffer_cultural = []
        buffer_style = []

        current_section = None

        for line in lines:
            line = line.strip()
            if not line:
                continue

            line_lower = line.lower()

            # Robust key detection
            if "cultural context" in line_lower:
                current_section = "cultural"
                if ":" in line:
                    val = line.split(":", 1)[1].strip()
                    if val:
                        buffer_cultural.append(val)
                continue
            elif "speaking style" in line_lower:
                current_section = "style"
                if ":" in line:
                    val = line.split(":", 1)[1].strip()
                    if val:
                        buffer_style.append(val)
                continue

            # Append content to current section
            if current_section == "cultural":
                buffer_cultural.append(line)
            elif current_section == "style":
                buffer_style.append(line)

        # Construct final values
        generated_cultural = " ".join(buffer_cultural).strip()
        generated_style = " ".join(buffer_style).strip()

        # Update if original was missing
        if not cultural_context:
            cultural_context = generated_cultural
        if not speaking_style:
            speaking_style = generated_style

        logger.info(
            "Generated Context - Cultural: %s, Style: %s",
            cultural_context,
            speaking_style,
        )
        return cultural_context, speaking_style

    except Exception as e:
        logger.error(f"Failed to generate cultural context: {e}")
        return cultural_context or "", speaking_style or ""
