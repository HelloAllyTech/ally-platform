"""
Safety utilities for speech prosody generation.
"""

import re
from typing import Optional

from app.core.logger import get_logger

logger = get_logger(__name__)


def clamp_value(
    value: float,
    current_value: Optional[float],
    min_val: float,
    max_val: float,
    max_delta_percent: float,
) -> float:
    """
    Clamp a value to be within min/max bounds and limit change from current value.

    Args:
        value: The new target value
        current_value: The current value (or None if no current value)
        min_val: Absolute minimum allowed value
        max_val: Absolute maximum allowed value
        max_delta_percent: Maximum allowed percentage change from current value
            (0.05 = 5%)

    Returns:
        Clamped value
    """
    # First, clamp to absolute bounds
    clamped_value = max(min_val, min(value, max_val))

    if current_value is None:
        return clamped_value

    # Determine delta calculation strategy
    # Heuristic:
    # If range crosses zero (min < 0 < max), it's likely an additive scale
    # (like pitch/volume in dB/semitones)
    # -> Use percentage of RANGE as the step limit (constant step size)
    # If range is all positive (min >= 0), it's likely a multiplicative scale
    # (like rate/speed)
    # -> Use percentage of CURRENT VALUE as the step limit (proportional step size)

    is_zero_crossing = (min_val < 0) and (max_val > 0)

    if is_zero_crossing:
        # Additive / Zero-centered scale
        abs_range = max_val - min_val
        max_step = abs_range * max_delta_percent

        # We enforce a constant maximum step size
        min_allowed = current_value - max_step
        max_allowed = current_value + max_step
    else:
        # Multiplicative / Positive scale
        # Handle 0 or near-zero current value safely
        if abs(current_value) < 0.001:
            # Fallback to small absolute step if current is 0
            # For a positive scale starting at 0, use 10% of max as step?
            # Or just use range-based fallback
            max_step = (max_val - min_val) * max_delta_percent
            min_allowed = current_value - max_step
            max_allowed = current_value + max_step
        else:
            # Percentage of current value
            delta = abs(current_value) * max_delta_percent
            min_allowed = current_value - delta
            max_allowed = current_value + delta

    # Clamp to delta range
    final_value = max(min_allowed, min(clamped_value, max_allowed))

    # Final check against absolute bounds
    final_value = max(min_val, min(final_value, max_val))

    return final_value


def sanitize_ssml(text: str) -> str:
    """
    Sanitize SSML text to remove extreme prosody tags.

    Removes or downgrades:
    - x-slow, x-fast
    - x-low, x-high
    - x-soft, x-loud

    Args:
        text: The text potentially containing SSML

    Returns:
        Sanitized text
    """
    if not text:
        return text

    original_text = text

    # Replace extreme rate tags
    text = re.sub(r'rate=["\']x-slow["\']', 'rate="slow"', text)
    text = re.sub(
        r'rate=["\']x-fast["\']', 'rate="medium"', text
    )  # x-fast is too fast usually

    # Replace extreme pitch tags
    text = re.sub(r'pitch=["\']x-low["\']', 'pitch="low"', text)
    text = re.sub(
        r'pitch=["\']x-high["\']', 'pitch="medium"', text
    )  # x-high can be squeaky

    # Replace extreme volume tags
    text = re.sub(r'volume=["\']x-soft["\']', 'volume="soft"', text)
    text = re.sub(
        r'volume=["\']x-loud["\']', 'volume="medium"', text
    )  # x-loud can distort

    if text != original_text:
        logger.info("[Speech Prosody] Sanitized extreme SSML tags from response text.")

    return text
