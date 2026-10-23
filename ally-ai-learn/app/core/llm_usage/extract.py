"""Token-usage extraction from a LangChain AIMessage.

Covers both ChatOpenAI and ChatGoogleGenerativeAI, which both expose the
LangChain-normalized ``usage_metadata`` ({input_tokens, output_tokens,
total_tokens}) on the returned AIMessage, with a fallback to the raw
provider ``response_metadata['token_usage']``.
"""

from typing import Any, Optional, Tuple


def extract_usage_from_aimessage(
    response: Any,
) -> Optional[Tuple[int, int, int, int]]:
    """Return (prompt_tokens, completion_tokens, total_tokens, cached_tokens)
    or None.

    ``cached_tokens`` is the count of prompt tokens served from the
    provider's prompt cache (a hit), letting callers verify a cache is
    actually landing rather than just assuming it from prompt ordering.
    LangChain normalizes this as ``usage_metadata.input_token_details.
    cache_read`` across providers (OpenAI's own field is
    ``prompt_tokens_details.cached_tokens``); it is 0 when the provider
    doesn't report it or there was no hit.

    Never raises — returns None when usage isn't available.
    """
    try:
        usage = getattr(response, "usage_metadata", None)
        if usage:
            prompt = int(usage.get("input_tokens", 0) or 0)
            completion = int(usage.get("output_tokens", 0) or 0)
            total = int(usage.get("total_tokens", 0) or 0) or (prompt + completion)
            input_details = usage.get("input_token_details") or {}
            cached = int(input_details.get("cache_read", 0) or 0)
            if prompt or completion or total:
                return prompt, completion, total, cached

        meta = getattr(response, "response_metadata", None) or {}
        token_usage = meta.get("token_usage") or meta.get("usage") or {}
        if token_usage:
            prompt = int(token_usage.get("prompt_tokens", 0) or 0)
            completion = int(token_usage.get("completion_tokens", 0) or 0)
            total = int(token_usage.get("total_tokens", 0) or 0) or (
                prompt + completion
            )
            # Raw OpenAI response shape (pre-LangChain-normalization).
            prompt_details = token_usage.get("prompt_tokens_details") or {}
            cached = int(prompt_details.get("cached_tokens", 0) or 0)
            if prompt or completion or total:
                return prompt, completion, total, cached
    except Exception:
        return None
    return None


def extract_usage_from_openai_completion(
    completion: Any,
) -> Optional[Tuple[int, int, int, int]]:
    """(prompt, completion, total, cached) from a raw OpenAI SDK completion.

    For the call sites that use ``AsyncOpenAI`` directly (the event and
    behaviour classifiers, to avoid LiveKit issue #2836) rather than a
    LangChain model: their ``ChatCompletion`` / ``ParsedChatCompletion`` carries
    ``usage`` as an object, not LangChain's ``usage_metadata`` dict.

    Never raises — returns None when usage isn't available.
    """
    try:
        usage = getattr(completion, "usage", None)
        if usage is None:
            return None
        prompt = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        total = int(getattr(usage, "total_tokens", 0) or 0) or (
            prompt + completion_tokens
        )
        details = getattr(usage, "prompt_tokens_details", None)
        cached = int(getattr(details, "cached_tokens", 0) or 0) if details else 0
        if prompt or completion_tokens or total:
            return prompt, completion_tokens, total, cached
    except Exception:
        return None
    return None
