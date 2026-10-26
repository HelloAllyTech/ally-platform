"""Prompts for helper paraphrased event detection."""

from app.prompts.resolver import load_and_format


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
    system_prompt = load_and_format("events/helper_paraphrased_system")

    user_prompt = load_and_format(
        "events/helper_paraphrased_user",
        agent_message=agent_message,
        counselor_message=counselor_message,
    )

    return system_prompt, user_prompt
