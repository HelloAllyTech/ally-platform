from typing import Optional
from langchain_core.messages import SystemMessage
from app.core.scenario.base import VoicePromptData


def _get_optional_block(label: str, value: Optional[str]) -> str:
    """Wraps an optional value in a simple formatted block if it exists."""
    if value:
        return f"**{label}:**\n{value}\n\n"
    return ""


def _get_gender_details(prompt_data: VoicePromptData) -> str:
    """Creates formatted blocks for optional gender identity and orientation."""
    content = ""
    if prompt_data.gender_identity:
        content += f"**Your gender identity:**\n{prompt_data.gender_identity}\n\n"
    if prompt_data.sexual_orientation:
        content += f"**Your sexual orientation:**\n{prompt_data.sexual_orientation}\n\n"
    return content


def _get_behavioral_guidelines(prompt_data: VoicePromptData) -> str:
    """Returns specific session guidelines if provided."""
    if prompt_data.session_behavior_guidelines:
        return f"**How will you behave in this session:**\n{prompt_data.session_behavior_guidelines}\n\n"
    return ""


# --- Main Prompt Generator Function ---

def generate_system_message(
        prompt_data: VoicePromptData,
        next_instruction: Optional[str] = None
) -> SystemMessage:
    """
    Generates a SystemMessage prompt for an AI roleplay assistant
    based on the structured VoicePromptData.

    Args:
        prompt_data: An instance of VoicePromptData containing all client info.
        next_instruction: Optional, conversation-specific guidance.

    Returns:
        A SystemMessage object with the complete, formatted prompt.
    """

    # Use helper functions to build optional sections
    gender_details_block = _get_gender_details(prompt_data)
    profession_block = _get_optional_block("Your profession", prompt_data.profession)
    guidelines_block = _get_behavioral_guidelines(prompt_data)
    core_memories_block = _get_optional_block("Your core memories influencing your beliefs & actions",
                                              prompt_data.core_memories)
    personality_block = _get_optional_block("Your personality", prompt_data.personality)
    starting_state_block = _get_optional_block("Your current thoughts",
                                               prompt_data.starting_state)  # Mapped from starting_state
    emotional_needs_block = _get_optional_block("Your emotional needs from this counselling session",
                                                prompt_data.emotional_needs)
    tone_block = _get_optional_block("Your talking stye/tone", prompt_data.tone)
    # agent_goal is omitted as per user's new example structure
    # system_instruction from prompt_data is ignored and overridden below

    # Handle the 'next_instruction' block
    next_instruction_block = ""
    if next_instruction:
        next_instruction_block = f"""---
        ## Next Conversation Instruction
        Follow this conversation-specific guidance for your next replies:
        ```
        {next_instruction}
        ```
        """

    # Hardcoded system instruction as requested
    system_instruction = """"You are an AI roleplay assistant for counselor training. In this simulation, you must act ONLY as the **client** in a therapy session. Stay fully in character, provide realistic dialogue, and do not switch roles unless explicitly instructed.

    **Important Instuctions:**
     - Prefer first-person phrasing (e.g., ""I feel…"", ""I've been struggling with…"").
    - Allow the counselor to guide the conversation.
    - If the counselor is silent or open-ended, share one thought, feeling, or small story, then stop.
    - Maintain consistency with your life history but allow natural variation in tone and detail.
    - Respond naturally, as a real client would (use first-person voice).
    - Keep answers concise (2–6 sentences), unless a longer response is natural.
    - Reveal information gradually, not all at once.
    - Start with few details and open up more as counsellor asks questions.
    - Show authentic emotions, hesitations, or small inconsistencies typical of real conversations.
    - Do not give therapy advice, diagnoses, or act as the counselor.
    - If sensitive topics arise, respond realistically but without graphic or explicit detail.
    - Keep each reply under ~120 words to simulate session pacing."""

    # Assemble the final prompt
    system_prompt = f"""
    {system_instruction}
    
    **Your name:**
    {prompt_data.name}
    
    **Your age:**
    {prompt_data.age}
    
    **Your gender:**
    {prompt_data.gender}
    
    {gender_details_block}
    
    **Your current location:**
    {prompt_data.current_location}
    
    {profession_block}
    
    **Your current context:**
    {prompt_data.context}
    
    {guidelines_block}
    
    **Summary of your life's history:**
    {prompt_data.life_history_summary}
    
    {core_memories_block}
    {personality_block}
    {starting_state_block}
    {emotional_needs_block}
    {tone_block}
    
    **Begin the conversation by saying:**
    {prompt_data.opening_statements}
    
    {next_instruction_block}
    """

    return SystemMessage(content=system_prompt.strip())

