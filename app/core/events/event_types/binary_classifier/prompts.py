from textwrap import dedent
from typing import Optional, List
from app.core.events.event_types.binary_classifier.schemas import Example

def get_binary_classifier_prompt(
    class_name: str, 
    message: str,
    positive_examples: Optional[List[Example]] = None,
    negative_examples: Optional[List[Example]] = None
) -> str:
    """
    Returns a prompt for the Binary Classifier event.

    Args:
        class_name (str): The name of the class to classify against.
        message (str): The message to classify.
        positive_examples (Optional[List[Example]]): Examples of positive cases.
        negative_examples (Optional[List[Example]]): Examples of negative cases.

    Returns:
        str: The prompt string.
    """
    prompt = f'You are a binary classifier. Determine if the following text belongs to the class: "{class_name}".\n'
    
    if positive_examples or negative_examples:
        prompt += "\nHere are some examples:\n"
        
        if positive_examples:
            prompt += "\nPositive examples (belongs to the class):\n"
            for i, example in enumerate(positive_examples, 1):
                prompt += f"{i}. {example.text}\n"
        
        if negative_examples:
            prompt += "\nNegative examples (does NOT belong to the class):\n"
            for i, example in enumerate(negative_examples, 1):
                prompt += f"{i}. {example.text}\n"
    
    prompt += f'\nText to classify:\n<text>{message}</text>\n'
    prompt += f'\nRespond with true if the text belongs to the class "{class_name}", otherwise false.'
    
    return prompt