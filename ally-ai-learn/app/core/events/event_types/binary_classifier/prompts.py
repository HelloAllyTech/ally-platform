from typing import Any, List, Optional, Sequence, Tuple

from app.core.events.event_types.binary_classifier.schemas import (
    BinaryClassifierData,
    Example,
)
from app.prompts.resolver import load_and_format


def _build_examples_block(
    positive_examples: Optional[List[Example]],
    negative_examples: Optional[List[Example]],
) -> str:
    if not positive_examples and not negative_examples:
        return ""

    parts = ["\nHere are some examples:"]

    if positive_examples:
        parts.append("\nPositive examples (belongs to the class):")
        for i, example in enumerate(positive_examples, 1):
            parts.append(f"{i}. {example.text}")

    if negative_examples:
        parts.append("\nNegative examples (does NOT belong to the class):")
        for i, example in enumerate(negative_examples, 1):
            parts.append(f"{i}. {example.text}")

    return "\n".join(parts) + "\n"


def get_binary_classifier_prompt(
    class_name: str,
    message: str,
    positive_examples: Optional[List[Example]] = None,
    negative_examples: Optional[List[Example]] = None,
    prompt_data: Any = None,
) -> Tuple[str, str]:
    """
    Returns a tuple of (system_prompt, user_prompt) for the Binary Classifier event.

    Args:
        class_name (str): The name of the class to classify against.
        message (str): The message to classify.
        positive_examples (Optional[List[Example]]): Examples of positive cases.
        negative_examples (Optional[List[Example]]): Examples of negative cases.
        prompt_data: The session's prompt data, carrying the Skills Store text.

    Returns:
        Tuple[str, str]: A tuple containing (system_prompt, user_prompt).
    """
    examples_block = _build_examples_block(positive_examples, negative_examples)

    system_prompt = load_and_format(
        "events/binary_classifier_system",
        prompt_data=prompt_data,
        class_name=class_name,
        examples_block=examples_block,
    )

    user_prompt = load_and_format(
        "events/binary_classifier_user",
        prompt_data=prompt_data,
        message=message,
    )

    return system_prompt, user_prompt


def get_batch_binary_classifier_prompt(
    items: Sequence[Tuple[str, BinaryClassifierData]],
    message: str,
    prompt_data: Any = None,
) -> Tuple[str, str]:
    """Build (system_prompt, user_prompt) for classifying `message` against
    several binary-classifier classes in a single call.

    Args:
        items: (event_id, BinaryClassifierData) pairs — one per class.
        message: The counselor text to classify against every class.
    """
    blocks = []
    for event_id, data in items:
        examples_block = _build_examples_block(
            data.positive_examples, data.negative_examples
        )
        blocks.append(f'- id="{event_id}" class="{data.class_name}"{examples_block}')
    classes_block = "\n".join(blocks)

    system_prompt = load_and_format(
        "events/binary_classifier_batch_system",
        prompt_data=prompt_data,
        classes_block=classes_block,
    )
    user_prompt = load_and_format(
        "events/binary_classifier_user",
        prompt_data=prompt_data,
        message=message,
    )

    return system_prompt, user_prompt
