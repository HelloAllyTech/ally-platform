"""Prompts for helper paraphrased event detection."""

from textwrap import dedent


def get_paraphrase_evaluation_prompt(
    agent_message: str, counselor_message: str
) -> tuple[str, str]:
    """
    Generate system and user prompts for evaluating if counselor paraphrased agent.

    Args:
        agent_message: The agent's message that the counselor may have paraphrased
        counselor_message: The counselor's message to check for paraphrasing

    Returns:
        Tuple of (system_prompt, user_prompt)
    """
    system_prompt = dedent(
        """
        You are an expert evaluator for determining if a counselor has paraphrased
        what an agent said in a counseling conversation.

        Your task is to evaluate whether the counselor's message is a paraphrase
        (restatement in different words) of the agent's previous message, while
        maintaining the same core meaning and intent.

        A paraphrase means:
        - The counselor expresses the same idea or information as the agent
        - Uses different words, phrasing, or sentence structure
        - Maintains the same semantic meaning and intent
        - Shows understanding of what the agent communicated

        A paraphrase is NOT:
        - A direct quote or exact repetition
        - A completely different topic or unrelated response
        - A question about what the agent said
        - A simple acknowledgment like "okay" or "I see"

        Return "yes" (true) if the counselor genuinely restated the agent's
        message in their own words while preserving the core meaning.
        Return "no" (false) otherwise.

        Be strict but fair. Only return true if the counselor clearly paraphrased
        the agent's message with different wording but the same core meaning.
        """
    ).strip()

    user_prompt = dedent(
        f"""
        Agent's message:
        <agent_message>{agent_message}</agent_message>

        Counselor's message:
        <counselor_message>{counselor_message}</counselor_message>

        Evaluate if the counselor's message is a paraphrase of the agent's message.
        Return true if it is a paraphrase, false otherwise.
        """
    ).strip()

    return system_prompt, user_prompt
