"""Persona-bible chunk selection for the Actor's L5 context layer.

Selection order (mirrors the char-cap discipline of
app/core/graph/knowledge_retrieval.py):

1. Director-nominated topics first — the Director's verdict carries
   ``retrieve_topics`` naming what the conversation is heading toward.
2. Keyword fallback — when the Director hasn't nominated anything (or its
   topics matched nothing), match the trainee's last utterance against chunk
   topics/content.
3. Baseline — if nothing matches at all, take chunks in spec order so the
   Actor always has SOME persona grounding.

A cumulative character cap bounds the prompt budget regardless of how many
chunks match.
"""

from __future__ import annotations

import math
import re
from typing import Callable, Dict, Iterable, List, Optional, Sequence

from app.core.logger import get_logger
from app.roleplay_v2.spec.models import PersonaChunk, ScenarioSpec

logger = get_logger(__name__)

DEFAULT_MAX_CHUNK_CHARS = 4000

# Extra similarity added to a chunk whose topics the Director explicitly
# nominated — keeps the Director's steer authoritative under semantic ranking.
_DIRECTOR_TOPIC_BOOST = 0.5

# Words this short carry no retrieval signal ("the", "and", "you", ...).
_MIN_KEYWORD_LEN = 4
_WORD_RE = re.compile(r"[\w']+", re.UNICODE)


def _keywords(text: Optional[str]) -> set[str]:
    if not text:
        return set()
    return {w.lower() for w in _WORD_RE.findall(text) if len(w) >= _MIN_KEYWORD_LEN}


def _topic_tokens(chunk: PersonaChunk) -> set[str]:
    return {t.strip().lower() for t in chunk.topics if t and t.strip()}


def _stem_matches(topics: set[str], words: set[str]) -> int:
    """Count topics matched by any word, tolerating simple inflections
    ("sleeping" matches topic "sleep", "layoffs" matches "layoff")."""
    hits = 0
    for topic in topics:
        for word in words:
            if word == topic or word.startswith(topic) or topic.startswith(word):
                hits += 1
                break
    return hits


def select_chunks(
    spec: ScenarioSpec,
    retrieve_topics: Optional[Iterable[str]],
    last_user_text: Optional[str],
    max_chars: int = DEFAULT_MAX_CHUNK_CHARS,
) -> List[PersonaChunk]:
    """Pick the persona chunks to inject this turn, within ``max_chars``."""
    chunks = spec.persona.chunks
    if not chunks:
        return []

    nominated = {t.strip().lower() for t in (retrieve_topics or []) if t and t.strip()}
    keywords = _keywords(last_user_text)

    director_hits: List[tuple[int, PersonaChunk]] = []
    keyword_hits: List[tuple[int, PersonaChunk]] = []
    rest: List[PersonaChunk] = []

    for chunk in chunks:
        topics = _topic_tokens(chunk)
        director_overlap = len(topics & nominated) if nominated else 0
        if director_overlap:
            director_hits.append((director_overlap, chunk))
            continue
        # Topic matches (stem-tolerant) dominate; bare content-word overlap is
        # a weak tie-breaker so incidental prose can't outrank a topic hit.
        topic_hits = _stem_matches(topics, keywords) if keywords else 0
        keyword_overlap = topic_hits * 10
        if keywords:
            content_words = _keywords(chunk.content)
            keyword_overlap += min(len(content_words & keywords), 3)
        if topic_hits:
            keyword_hits.append((keyword_overlap, chunk))
        else:
            rest.append(chunk)

    director_hits.sort(key=lambda p: -p[0])
    keyword_hits.sort(key=lambda p: -p[0])

    ranked: List[PersonaChunk] = [c for _, c in director_hits] + [
        c for _, c in keyword_hits
    ]
    if not ranked:
        # Baseline: no signal at all — keep the persona grounded anyway.
        ranked = list(chunks)
    else:
        # Fill remaining budget with unmatched chunks in spec order.
        ranked += rest

    selected: List[PersonaChunk] = []
    total = 0
    for chunk in ranked:
        cost = len(chunk.content)
        if selected and total + cost > max_chars:
            break
        selected.append(chunk)
        total += cost
        if total >= max_chars:
            break

    logger.debug(
        "[roleplay_v2] select_chunks: nominated=%s director_hits=%d "
        "keyword_hits=%d selected=%s (%d chars)",
        sorted(nominated),
        len(director_hits),
        len(keyword_hits),
        [c.id for c in selected],
        total,
    )
    return selected


# ---------------------------------------------------------------------------
# Semantic (embeddings) ranking — optional, pluggable
# ---------------------------------------------------------------------------


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity of two vectors; 0 for a zero/empty vector."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def chunk_embedding_text(chunk: PersonaChunk) -> str:
    """Canonical text to embed for a chunk (topics + content)."""
    topics = " ".join(chunk.topics or [])
    return f"{topics}\n{chunk.content}".strip()


def rank_chunks_semantic(
    chunks: Sequence[PersonaChunk],
    query_vec: Sequence[float],
    chunk_vecs: Dict[str, Sequence[float]],
    nominated: Optional[set[str]] = None,
    max_chars: int = DEFAULT_MAX_CHUNK_CHARS,
) -> List[PersonaChunk]:
    """Rank chunks by cosine similarity to the query, boosting Director topics,
    then apply the same cumulative char cap as the lexical selector.

    Pure and network-free: ``query_vec`` and ``chunk_vecs`` are precomputed by
    the caller (chunk vectors embedded once per session; only the short query
    is embedded per turn), so this stays off the actor's latency budget.
    """
    nominated = nominated or set()
    scored: List[tuple[float, PersonaChunk]] = []
    for chunk in chunks:
        vec = chunk_vecs.get(chunk.id)
        score = _cosine(query_vec, vec) if vec is not None else 0.0
        if nominated and (_topic_tokens(chunk) & nominated):
            score += _DIRECTOR_TOPIC_BOOST
        scored.append((score, chunk))
    # Stable sort by descending score (ties keep spec order).
    ranked = [c for _, c in sorted(scored, key=lambda p: -p[0])]

    selected: List[PersonaChunk] = []
    total = 0
    for chunk in ranked:
        cost = len(chunk.content)
        if selected and total + cost > max_chars:
            break
        selected.append(chunk)
        total += cost
        if total >= max_chars:
            break
    return selected


def build_semantic_retriever(
    embed_fn: Callable[[str], Sequence[float]],
    chunk_vecs: Dict[str, Sequence[float]],
    *,
    fallback=select_chunks,
) -> Callable[..., List[PersonaChunk]]:
    """Return a retriever with the same signature as ``select_chunks`` that
    ranks semantically, falling back to lexical selection on any error.

    ``embed_fn`` embeds the (short) per-turn query synchronously; ``chunk_vecs``
    are the precomputed per-chunk vectors keyed by chunk id. Wire it by passing
    the result as ``ActorEngine(retriever=...)`` when embeddings are enabled.
    """

    def _retriever(
        spec: ScenarioSpec,
        retrieve_topics: Optional[Iterable[str]],
        last_user_text: Optional[str],
        max_chars: int = DEFAULT_MAX_CHUNK_CHARS,
    ) -> List[PersonaChunk]:
        chunks = spec.persona.chunks
        if not chunks:
            return []
        nominated = {
            t.strip().lower() for t in (retrieve_topics or []) if t and t.strip()
        }
        query = " ".join(
            part for part in [" ".join(nominated), last_user_text or ""] if part
        ).strip()
        if not query:
            return fallback(spec, retrieve_topics, last_user_text, max_chars)
        try:
            query_vec = embed_fn(query)
            return rank_chunks_semantic(
                chunks, query_vec, chunk_vecs, nominated, max_chars
            )
        except Exception as exc:  # noqa: BLE001 - never break the actor turn
            logger.warning(
                "[roleplay_v2] semantic retrieval failed (%s) — lexical fallback",
                exc,
            )
            return fallback(spec, retrieve_topics, last_user_text, max_chars)

    return _retriever
