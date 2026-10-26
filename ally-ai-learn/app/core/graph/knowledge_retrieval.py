import hashlib
import json
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.graph.utils import convert_messages_to_chat_messages
from app.core.logger import get_logger
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)


class RetrievedContextStore:
    """Worker-owned holder for asynchronously refreshed knowledge context.

    Mirrors RollingSummaryStore: the title-selection LLM call runs as a
    DETACHED task writing here, so refresh-due turns serve the previous
    context instantly instead of paying ~1s inside the reply gate
    (KNOWLEDGE_RETRIEVAL_ASYNC). Graph state still carries the value the
    prompt consumed each turn; this store is the freshness handoff.

    ``turns_until_refresh`` lives here rather than in checkpointed graph
    state for the same reason RollingSummaryStore keeps its bookkeeping
    off-checkpoint: a barge-in cancels the whole in-flight graph invocation,
    and LangGraph only commits a checkpoint after a full superstep
    completes, so a cancelled superstep can silently discard a countdown
    decrement that already happened. A plain attribute mutated as a side
    effect during node execution survives that — a discarded checkpoint
    can't undo it.
    """

    def __init__(self) -> None:
        from app.core.graph.knowledge_locks import KnowledgeUnlockTracker

        self.context = None
        self.turns_until_refresh = 0
        self._task = None
        # Trainer-authored memory locks: the session's high-water state. Lives
        # here because it is retrieval-side, per-session and off-checkpoint for
        # the same barge-in reason as the countdown above.
        self.unlocks = KnowledgeUnlockTracker()

    @property
    def in_flight(self) -> bool:
        return self._task is not None and not self._task.done()


_RETRIEVAL_CACHE: "OrderedDict[str, str]" = OrderedDict()

# Cap injected RAG context to keep prompt budgets predictable. Without
# these the prompt could balloon to tens of KB when the LLM matches many
# titles or knowledge entries are large.
#  - PER_MATCH: each knowledge entry's content is truncated at this many
#    characters. Big enough to fit a paragraph or two of guidance per
#    title, small enough to bound the worst case at MAX_MATCHES * cap.
#  - TOTAL: hard ceiling across all matches. When the running total
#    would exceed this, remaining matches are dropped with a marker so
#    the prompt reader can see something was trimmed.
_MAX_PER_MATCH_CHARS = 1500
_MAX_TOTAL_CONTEXT_CHARS = 8000


class RelevantKeys(BaseModel):
    """Structured output schema for knowledge retrieval."""

    titles: List[str] = Field(
        description="List of relevant knowledge topic titles from the available topics"
    )


def build_knowledge_map(
    knowledge_sources: Optional[List[Dict[str, Any]]],
) -> Dict[str, str]:
    """
    Convert a list of title-content dicts into a lookup map.

    Entries missing either ``title`` or ``content`` (or with empty values)
    are silently skipped so the caller never has to guard against bad data.
    """
    if not knowledge_sources:
        return {}

    knowledge_map: Dict[str, str] = {}
    for entry in knowledge_sources:
        if not isinstance(entry, dict):
            continue
        title = entry.get("title", "")
        content = entry.get("content", "")
        if title and content:
            knowledge_map[title] = content

    return knowledge_map


def selected_glossary_sections(
    retrieved_context: Optional[str],
    glossary_sections: Any,
) -> List[str]:
    """Which Tier 1 glossary sections landed in this turn's retrieved context.

    Matches the exact ``**{title}:**`` framing `_format_retrieved_context`
    emits, so it also works on LRU-cache hits (the cache stores the formatted
    string). Returns the stable ``sectionCode`` when ally-be shipped it,
    falling back to the prefixed title. Feeds turn-metrics analytics
    (per-section hit rate — a published section that's never selected is dead
    weight or has a bad retrievalHint).
    """
    if not retrieved_context or not isinstance(glossary_sections, list):
        return []
    selected: List[str] = []
    for entry in glossary_sections:
        if not isinstance(entry, dict):
            continue
        title = entry.get("title", "")
        if title and f"**{title}:**" in retrieved_context:
            selected.append(entry.get("sectionCode") or title)
    return selected


def _format_retrieved_context(
    relevant_titles: List[str],
    knowledge_map: Dict[str, str],
) -> str:
    """Format matched knowledge entries as a markdown block, with both
    per-match and total-context size caps so the prompt budget stays
    bounded regardless of how many titles match or how large the entries
    are."""
    sections: List[str] = []
    total_chars = 0
    truncated_any_total = False
    per_match_truncations = 0
    matched_count = 0
    for title in relevant_titles:
        if title not in knowledge_map:
            continue

        content = knowledge_map[title]
        if len(content) > _MAX_PER_MATCH_CHARS:
            per_match_truncations += 1
            content = content[:_MAX_PER_MATCH_CHARS].rstrip() + " …[truncated]"

        section = f"**{title}:**\n{content}"
        # +2 accounts for the "\n\n" separator that join() will insert
        # between this section and the next.
        prospective_total = total_chars + len(section) + (2 if sections else 0)
        if prospective_total > _MAX_TOTAL_CONTEXT_CHARS:
            truncated_any_total = True
            break

        sections.append(section)
        total_chars = prospective_total
        matched_count += 1

    if truncated_any_total:
        sections.append("…[additional matches omitted to fit context budget]")

    # Truncation observability — grep `[RAG_TRUNC]` to see when caps fired.
    if per_match_truncations or truncated_any_total:
        logger.info(
            "[RAG_TRUNC] per_match_truncations=%d total_truncated=%s "
            "matched=%d/%d total_chars=%d cap_per_match=%d cap_total=%d",
            per_match_truncations,
            truncated_any_total,
            matched_count,
            len(relevant_titles),
            total_chars,
            _MAX_PER_MATCH_CHARS,
            _MAX_TOTAL_CONTEXT_CHARS,
        )

    return "\n\n".join(sections)


def _build_cache_key(messages: list, knowledge_map: Dict[str, str]) -> str:
    """Build a stable cache key for recent conversation + knowledge content."""
    recent_messages = messages[-10:]
    chat_messages = convert_messages_to_chat_messages(recent_messages)

    conversation_payload = [
        {"role": msg.role, "content": msg.content}
        for msg in chat_messages
        if msg.content
    ]
    knowledge_payload = sorted(knowledge_map.items())
    payload = {
        "conversation": conversation_payload,
        "knowledge": knowledge_payload,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
    ).hexdigest()


def _get_llm_identity(llm_client) -> str:
    """Best-effort identifier for the retrieval model/provider configuration."""
    llm_instance = getattr(llm_client, "llm_instance", None)
    if llm_instance is None:
        return "unknown"

    provider = llm_instance.__class__.__name__
    model = getattr(llm_instance, "model_name", None) or getattr(
        llm_instance, "model", None
    )
    if model:
        return f"{provider}:{model}"
    return provider


def _get_cached_retrieval(cache_key: str) -> Optional[str]:
    cached = _RETRIEVAL_CACHE.get(cache_key)
    if cached is None:
        return None
    _RETRIEVAL_CACHE.move_to_end(cache_key)
    return cached


def _store_cached_retrieval(cache_key: str, value: str) -> None:
    _RETRIEVAL_CACHE[cache_key] = value
    _RETRIEVAL_CACHE.move_to_end(cache_key)
    while len(_RETRIEVAL_CACHE) > settings.KNOWLEDGE_RETRIEVAL_CACHE_SIZE:
        _RETRIEVAL_CACHE.popitem(last=False)


#: Characters of each memory's content shown to the selector next to its title.
#: A bare title ("Arjun") says nothing about what the memory is; a one-line
#: gist does. Bounded because a scenario may carry up to 50 sources and this
#: call runs every refresh — at the cap that is ~2k extra tokens on the
#: selector, which is off the reply path.
_PREVIEW_CHARS = 160

#: The selector's system prompts, in the Skills Store; their live text comes
#: from the session's room metadata (``scenario.prompt_data``), so the live turn
#: makes no extra fetch. Memories only, or memories plus Tier 1 glossary
#: sections: two prompts, because the two share only the memory framing and
#: rule, and every other line differs. The memory framing was measured on the
#: real model (tests/integration/test_knowledge_selector_live.py): the old
#: "directly relevant to what is being discussed" framing recalled a family
#: memory on 0/9 family questions — gpt-4o-mini read "family at home" as not
#: about "Mother's health" — while the current framing recalled 9/9 with no
#: false picks on work-only turns. Previews alone did not move it; the framing
#: did. Keep the two prompts' framing in step when editing either.
_MEMORY_SELECTOR_PROMPT = "retrieval/memory_selector_system"
_MEMORY_GLOSSARY_SELECTOR_PROMPT = "retrieval/memory_glossary_selector_system"


def _preview(content: str) -> str:
    text = " ".join((content or "").split())
    if len(text) <= _PREVIEW_CHARS:
        return text
    return text[:_PREVIEW_CHARS].rsplit(" ", 1)[0] + "…"


def _build_selector_prompt(
    available_titles: List[str],
    glossary_hints: Optional[Dict[str, str]],
    previews: Optional[Dict[str, str]] = None,
    prompt_data: Any = None,
) -> str:
    """Build the title-selection system prompt.

    Scenario Knowledge Sources are the client's MEMORIES, and are framed that
    way (see the prompts above), each with a short content preview.

    With glossary sections the prompt also carries a dual-framing instruction
    (LANGUAGE_GLOSSARY_DESIGN.md §5.2): memories are selected for what the
    counselor is asking about (content-side), glossary sections for what the
    agent's NEXT reply needs (production-side, forward-looking) — with a
    deliberate bias toward inclusion, since a missed glossary section sends
    the agent into a vocabulary domain unarmed while a false positive only
    spends cap budget. Each glossary section's `retrievalHint` is rendered
    under its title as its trigger description.

    The topic list is built here and passed in as ``topics_block``; the text
    around it is the session's Skills Store prompt (``prompt_data``), stripped
    like the store's text so a local default's trailing newline never reaches
    the model.
    """
    glossary_hints = glossary_hints or {}
    previews = previews or {}
    lines: List[str] = []
    for title in available_titles:
        hint = glossary_hints.get(title)
        if hint:
            lines.append(f"- {title}")
            lines.append(f"  when to retrieve: {hint}")
            continue
        gist = previews.get(title)
        lines.append(f"- {title}: {gist}" if gist else f"- {title}")
    topics_block = "\n".join(lines)

    return load_and_format(
        (
            _MEMORY_GLOSSARY_SELECTOR_PROMPT
            if glossary_hints
            else _MEMORY_SELECTOR_PROMPT
        ),
        prompt_data=prompt_data,
        topics_block=topics_block,
    ).strip()


async def retrieve_relevant_knowledge(
    llm_client,
    messages: list,
    knowledge_map: Dict[str, str],
    glossary_hints: Optional[Dict[str, str]] = None,
    room_id: Optional[str] = None,
    prompt_data: Any = None,
) -> str:
    """
    Use the scenario LLM to identify which knowledge-base titles are
    relevant to the recent conversation, then return the formatted
    content for those titles.

    `knowledge_map` may include Tier 1 language-glossary sections (prefixed
    titles); `glossary_hints` maps those titles to their retrieval-trigger
    descriptions and switches the selector to the dual-framing prompt.
    `prompt_data` is the session's (``scenario.prompt_data``): the selector's
    system prompt is its Skills Store text.

    Returns an empty string when nothing is relevant or on any error.

    The selection call's tokens are emitted to ``llm_usage`` as
    ``knowledge_retrieval`` against ``room_id`` (else the graph run's room). A
    cache hit makes no call and records nothing.
    """
    if not knowledge_map or not messages:
        return ""

    try:
        available_titles = list(knowledge_map.keys())

        previews = {
            title: _preview(content)
            for title, content in knowledge_map.items()
            if not (glossary_hints and title in glossary_hints)
        }
        system_prompt = _build_selector_prompt(
            available_titles, glossary_hints, previews, prompt_data=prompt_data
        )

        # The prompt text is part of the key: the cache is process-wide, and
        # sessions started either side of a Skills Store publish run different
        # text. It also covers the glossary hints, which the prompt lists.
        prompt_digest = hashlib.md5(system_prompt.encode("utf-8")).hexdigest()
        cache_key = (
            f"{_get_llm_identity(llm_client)}:"
            f"{_build_cache_key(messages, knowledge_map)}:{prompt_digest}"
        )
        cached = _get_cached_retrieval(cache_key)
        if cached is not None:
            logger.debug("Knowledge retrieval cache hit")
            return cached

        recent_messages = messages[-10:]
        chat_messages = convert_messages_to_chat_messages(recent_messages)

        conversation_text = "\n".join(
            f"{msg.role}: {msg.content}" for msg in chat_messages if msg.content
        )

        # include_raw because the parsed model alone carries no usage metadata.
        structured_llm = llm_client.llm_instance.with_structured_output(
            RelevantKeys, include_raw=True
        )
        raw_result = await structured_llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Recent conversation:\n{conversation_text}"),
            ]
        )
        if isinstance(raw_result, dict):
            # Emitted before parsing: a parse failure still spent the tokens.
            from app.core.llm_usage.emitter import emit_langchain_usage
            from app.core.llm_usage.tasks import LLMTask

            emit_langchain_usage(
                raw_result.get("raw"),
                task=LLMTask.KNOWLEDGE_RETRIEVAL.value,
                llm_client=llm_client,
                room_id=room_id,
            )
            result = raw_result.get("parsed")
        else:
            # Defensive: some providers/wrappers may ignore include_raw.
            result = raw_result

        if not result or not result.titles:
            _store_cached_retrieval(cache_key, "")
            return ""

        formatted_context = _format_retrieved_context(result.titles, knowledge_map)
        _store_cached_retrieval(cache_key, formatted_context)
        return formatted_context

    except Exception:
        logger.exception("Knowledge retrieval failed, continuing without context")
        return ""
