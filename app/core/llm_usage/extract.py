"""Token-usage extraction from a LangChain AIMessage.

Covers both ChatOpenAI and ChatGoogleGenerativeAI, which both expose the
LangChain-normalized ``usage_metadata`` ({input_tokens, output_tokens,
total_tokens}) on the returned AIMessage, with a fallback to the raw
provider ``response_metadata['token_usage']``.
"""

from typing import Any, Optional, Tuple


def extract_usage_from_aimessage(
    response: Any,
) -> Optional[Tuple[int, int, int]]:
    """Return (prompt_tokens, completion_tokens, total_tokens) or None.

    Never raises — returns None when usage isn't available.
    """
    try:
        usage = getattr(response, "usage_metadata", None)
        if usage:
            prompt = int(usage.get("input_tokens", 0) or 0)
            completion = int(usage.get("output_tokens", 0) or 0)
            total = int(usage.get("total_tokens", 0) or 0) or (prompt + completion)
            if prompt or completion or total:
                return prompt, completion, total

        meta = getattr(response, "response_metadata", None) or {}
        token_usage = meta.get("token_usage") or meta.get("usage") or {}
        if token_usage:
            prompt = int(token_usage.get("prompt_tokens", 0) or 0)
            completion = int(token_usage.get("completion_tokens", 0) or 0)
            total = int(token_usage.get("total_tokens", 0) or 0) or (
                prompt + completion
            )
            if prompt or completion or total:
                return prompt, completion, total
    except Exception:
        return None
    return None
