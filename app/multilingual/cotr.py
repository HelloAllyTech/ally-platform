"""
Chain of Translation (CoTR) implementation for multilingual text generation.
Based on Deshpande et al. (2024).

CoTR restructures prompts to bridge low-resource and high-resource languages
by instructing the LLM to translate internally, process in English, then translate back.
"""

from typing import Optional

from langchain_core.messages import SystemMessage

from app.core.scenario.base import PromptData
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _is_metadata_translated(prompt_data: Optional[PromptData]) -> bool:
    """
    Heuristic to detect if metadata is already translated.
    Checks if tone field contains non-ASCII characters.
    """
    if not prompt_data or not prompt_data.tone:
        return False

    # Simple check: if tone contains non-ASCII, likely translated
    return not all(ord(c) < 128 for c in prompt_data.tone)


def apply_cotr_enhancement(
    base_prompt: str,
    language_code: str,
    prompt_data: Optional[PromptData] = None,
) -> str:
    """
    Apply Chain of Translation (CoTR) enhancement to a prompt.

    CoTR restructures prompts to bridge low-resource and high-resource languages
    by instructing the LLM to:
    1. Translate input to English internally
    2. Process in English
    3. Translate back to target language maintaining persona

    Args:
        base_prompt: The original prompt
        language_code: Target language code (e.g., "hi-IN", "ml-IN")
        prompt_data: Optional prompt data for persona context

    Returns:
        Enhanced prompt with CoTR instructions
    """
    # Detect if this is a non-English language
    # Ensure language_code is a string before calling string methods
    if not isinstance(language_code, str):
        logger.warning(
            f"Invalid language_code type: {type(language_code)}, "
            f"expected str. Returning base prompt unchanged."
        )
        return base_prompt

    is_non_english = not language_code.startswith("en")

    if not is_non_english:
        logger.info(
            f"CoTR skipped: Language '{language_code}' is English, "
            "no enhancement needed"
        )
        return base_prompt  # No enhancement needed for English

    # Check if metadata is already translated
    metadata_is_translated = _is_metadata_translated(prompt_data)

    # General instructions for Indian languages (dative-subject languages)
    # Check if this is an Indian language
    is_indian_language = language_code.endswith("-IN") and not language_code.startswith(
        "en"
    )

    if is_indian_language:
        target_style = (
            "natural, colloquial, conversational style that matches the "
            "user's level of formality. "
            "CRITICAL GRAMMAR PRINCIPLES (Indian languages use "
            "dative-subject constructions differently than English): "
            "- DATIVE-SUBJECT CONSTRUCTIONS are GRAMMATICALLY CORRECT for: "
            "  * States and experiences (hunger, understanding, feeling): "
            "    Use dative case "
            "  * Feelings and emotions (sadness, happiness, fear): "
            "    Use dative case "
            "  * Receiving or having something: Use dative case "
            "  * Ability/capability expressions: When expressing ability, "
            "    inability, or capability to do something, use dative case - "
            "    this is CORRECT even when the verb is an action verb "
            "- Use NOMINATIVE case as SUBJECT for DIRECT ACTIONS "
            "(actions you are directly performing): "
            "  * When you are directly performing an action "
            "(studying, going, saying, doing): Use nominative case "
            "- Key linguistic distinction: "
            "  * Direct action (I am doing X now) → Use nominative case "
            "  * Experiencing state/feeling → Dative case is correct "
            "  * Expressing ability/inability/capability "
            "(I can/cannot do X, I was able/unable to do X) → "
            "    Dative case is correct, even when the verb is an action verb "
            "- Use simple, commonly-used verb forms - prefer everyday "
            "conjugations over complex/archaic forms "
            "- CRITICAL: AVOID causative verb forms "
            "(verbs that mean 'to make X happen' or 'to cause X') - "
            "these are formal/literary and low-frequency "
            "  * Instead of causative forms, use simpler, "
            "direct verb constructions "
            "  * Prefer simple past/present forms over complex "
            "causative conjugations "
            "- AVOID formal/literary verb patterns - use everyday verb forms "
            "that people use in casual conversation "
            "- Follow natural word order for the target language "
            "- Match the user's informality level - if they use casual "
            "language, respond casually "
            "- CRITICAL VOCABULARY SELECTION RULES: "
            "  * ALWAYS prefer the MOST COMMONLY USED word in everyday "
            "speech - this is your PRIMARY criterion "
            "  * Prefer loanwords/English borrowings that are widely used "
            "in casual conversation over formal native equivalents "
            "  * Prefer shorter, simpler words over longer, "
            "more complex synonyms "
            "  * For domain-specific terms (academic, technology, etc.), "
            "use the terms people actually use in conversation, "
            "not formal/literary alternatives "
            "  * AVOID literary, archaic, formal, or low-frequency words - "
            "if you're unsure between two options, choose the simpler, "
            "shorter, more common one "
            "  * AVOID causative verb forms - these are formal and "
            "low-frequency; use simpler verb constructions instead "
            "  * AVOID formal verb patterns - prefer simple, "
            "everyday verb forms "
            "  * When translating, actively check each word: "
            "'Would a person in this context use this word in everyday "
            "conversation?' If not, find a more common alternative "
            "  * For verbs, ask: 'Is this a simple, common verb form or a "
            "complex/causative/formal pattern?' If complex/formal, "
            "use a simpler alternative "
            "- Prefer shorter, simpler sentences over long, "
            "complex constructions "
            "- Use natural sentence flow - avoid stilted or overly "
            "formal phrasing"
        )
    else:
        target_style = "natural, colloquial, conversational"

    persona_name = prompt_data.name if prompt_data else None
    persona_tone = prompt_data.tone if prompt_data else None

    if metadata_is_translated:
        # Metadata already in target language - CoTR still helps with reasoning
        cotr_instructions = f"""
<COTR_INSTRUCTIONS>
Your scenario metadata is in {language_code}. To ensure high-quality, natural responses:

1. **UNDERSTAND** the scenario context (already in {language_code})
2. **PROCESS** complex reasoning and emotional understanding internally in English for accuracy and depth
3. **TRANSLATE** your final response to {target_style}
4. **MAINTAIN** the persona's tone and cultural authenticity throughout

{f"- Preserve the '{persona_tone}' tone in your response" if persona_tone else ""}
{f"- Respond as {persona_name} would naturally speak" if persona_name else ""}

**CRITICAL OUTPUT REQUIREMENTS:**
- Output ONLY in {language_code} - natural, conversational, matching the persona
- Use everyday language, local expressions if appropriate
- Match the user's level of informality
- Sound like a real person from the target region, not a translation
- Avoid overly formal vocabulary unless the persona requires it
- **VOCABULARY PRIORITY**: Use ONLY COMMON, FREQUENTLY-USED words that \
appear in everyday conversation - this is NON-NEGOTIABLE
  * Prefer loanwords/common borrowings over formal native equivalents \
when they're more widely used
  * Prefer shorter, simpler words over longer synonyms
  * For domain terms, use conversational equivalents, \
not formal/literary alternatives
  * AVOID causative verb forms - use simpler verb constructions
  * AVOID formal verb patterns - use everyday verb forms
  * Before outputting, review each word: if it sounds literary, \
formal, or uncommon, replace it with a simpler, \
more common alternative
- **GRAMMAR REVIEW**: Before outputting, review grammar:
  * Check that verb forms are simple and common, \
not complex/causative/formal
  * Verify subject-verb agreement is correct
  * Ensure word order is natural for the target language
  * Check that case markers match the verb type \
(communication verbs may need different markers than other verbs)
- Follow correct grammar patterns for the target language
- Use natural word order and sentence structure
</COTR_INSTRUCTIONS>
"""
    else:
        # Metadata in English - standard CoTR
        cotr_instructions = f"""
<COTR_INSTRUCTIONS>
You are generating responses in {language_code}. To ensure high-quality, natural output:

1. **ANALYZE** the user's input (which is in {language_code}) and \
determine the appropriate factual response based on your persona's \
knowledge base.

2. **TRANSLATE** the user's input internally into English for robust \
processing and thought generation. This helps you understand complex \
cultural context and reasoning better.

3. **FORMULATE** your response *internally in English* to ensure \
accuracy, detail, and proper reasoning. Think through the emotional \
state, cultural nuances, and appropriate response in English first.

4. **TRANSLATE** your final English response back into {target_style} \
that matches your defined persona.
   **CRITICAL: During translation, actively select vocabulary:**
   - For each word/phrase, choose the MOST COMMONLY USED option in \
everyday conversation
   - Prefer loanwords/common borrowings over formal native equivalents \
when they're more widely used
   - Prefer shorter, simpler words over longer synonyms
   - Match the register: if persona is casual/teenager/young person, \
use casual vocabulary; if formal/professional, use appropriate formal \
vocabulary
   - For domain terms (exam results, technology, etc.), use what people \
actually say in conversation, not formal alternatives
   - AVOID causative verb forms - these are formal and low-frequency; \
use simpler verb constructions instead
   - AVOID formal verb patterns - prefer simple, everyday verb forms
   - For verbs, check: 'Is this a simple, common form or a \
complex/causative/formal pattern?' If complex/formal, use a simpler \
alternative
   - If unsure between options, always choose the simpler, shorter, \
more frequently used word
{f"- Maintain the '{persona_tone}' tone throughout" if persona_tone else ""}
{f"- Respond as {persona_name} would naturally speak" if persona_name else ""}

5. **VOCABULARY REVIEW**: Before outputting, review every word in your response:
   - Replace any formal/literary words with their common, everyday equivalents
   - Replace any low-frequency words with high-frequency alternatives
   - Replace any causative verb forms with simpler verb constructions
   - Replace any formal verb patterns with everyday verb forms
   - Ensure domain-specific terms match what people actually use in \
conversation
   - Verify register matches the persona (casual vs formal)
   - For verbs, check if they're simple/common or complex/causative/formal \
- replace complex ones with simpler alternatives
   - If a word feels like it belongs in literature or formal writing, \
replace it with a simpler, more common alternative

6. **GRAMMAR REVIEW**: Before outputting, review grammar in your response:
   - Check that all verb forms are simple and common, not \
complex/causative/formal patterns
   - Verify subject-verb agreement is correct
   - Ensure word order is natural for the target language
   - Check that case markers match the verb type (communication verbs \
may need different markers than other verbs - use the appropriate marker \
for each verb type)
   - If you find complex grammatical constructions, simplify them

7. **OUTPUT** ONLY the final {language_code} response. Do not include \
English translations or explanations.

**CRITICAL OUTPUT REQUIREMENTS:**
- The final output must be natural, colloquial {language_code} that \
sounds like a real person from the target region, not a translation
- Use everyday language, local expressions, and match the user's level \
of informality
- Avoid overly formal vocabulary (like 'atisheghra', 'kripya', \
'dhanyavaad' in a stilted manner) unless the persona requires it
- If the user is informal, match their level of informality
- Sound authentic and conversational, not like a textbook translation
- **VOCABULARY PRIORITY**: Use ONLY COMMON, FREQUENTLY-USED words that \
appear in everyday conversation - this is NON-NEGOTIABLE
  * Prefer loanwords/common borrowings over formal native equivalents \
when they're more widely used
  * Prefer shorter, simpler words over longer synonyms
  * For domain terms, use conversational equivalents, not \
formal/literary alternatives
  * AVOID causative verb forms - use simpler verb constructions instead
  * AVOID formal verb patterns - use everyday verb forms
  * If you find yourself using a word that sounds literary, formal, or \
uncommon, STOP and replace it with a simpler, more common alternative
- **GRAMMAR REQUIREMENTS**:
  * Use simple, common verb forms - avoid complex/causative/formal \
verb patterns
  * Ensure subject-verb agreement is correct
  * Use natural word order for the target language
  * Use appropriate case markers for each verb type (communication \
verbs may need different markers than other verbs)
- Follow correct grammar patterns for the target language - use proper \
verb forms, subject-object agreement, and natural word order
- Use natural sentence structure - avoid overly complex or formal \
constructions
</COTR_INSTRUCTIONS>
    """

    enhanced_prompt = f"{base_prompt}\n\n{cotr_instructions}"
    logger.info(
        f"Applied CoTR enhancement for language '{language_code}' "
        f"(metadata_translated={metadata_is_translated}, "
        f"is_indian_language={is_indian_language})"
    )

    return enhanced_prompt


def enhance_system_message_with_cotr(
    system_message: SystemMessage,
    language_code: str,
    prompt_data: Optional[PromptData] = None,
) -> SystemMessage:
    """
    Enhance a SystemMessage with CoTR instructions.

    Args:
        system_message: Original system message
        language_code: Target language code
        prompt_data: Optional prompt data for persona context

    Returns:
        Enhanced SystemMessage with CoTR instructions
    """
    enhanced_content = apply_cotr_enhancement(
        base_prompt=system_message.content,
        language_code=language_code,
        prompt_data=prompt_data,
    )

    return SystemMessage(content=enhanced_content)
