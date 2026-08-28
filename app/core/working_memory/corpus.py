"""The pool `salient_backstory` is recalled FROM, built once per session.

§7.1's claim is that a persona should be *recalled* rather than *dumped*, and
until now this package had the recall function (`recall.select`) with nothing to
recall from — `salient_backstory` was populated by no caller, so the block
rendered its named absence every turn. This module is the missing half.

Two sources fold into one pool, which is the whole point of phase 6 (§14):

- **`character_profile_text`** — the client's own life. Today it is dumped into
  the prompt whole, every turn, whether or not any of it bears on what was just
  said. That is the §7.1 failure in its purest form: a person does not recite
  their biography, they remember the part that the moment touched.
- **retrieved scenario knowledge** — what the old `{retrieved_context}` block
  carried. Folding it in here rather than retiring it means the same salience
  function ranks both, so a fact about the client and a fact from the case file
  compete on relevance instead of occupying separate fixed-size blocks.

The pool is immutable for the session and deliberately NOT part of
`ClientWorkingMemory`: it would be deep-copied on every snapshot, every turn,
for content that never changes. `roleplay_v2` made the same split — chunks live
on the spec, selection output lives in state.

Embedding vectors, when an embedding client is available, are computed once here
and never again. That is `persona_bible`'s discipline and the reason its semantic
tier was affordable: per-turn cost is cosine arithmetic over precomputed
vectors, not a network call.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence

from app.core.logger import get_logger
from app.core.working_memory.state import Fact

logger = get_logger(__name__)

#: Upper bound on pooled facts. A profile long enough to exceed this is being
#: used as a document store, and ranking 400 candidates per turn to render five
#: is waste rather than thoroughness.
MAX_POOL_FACTS = 120

#: A chunk shorter than this is a heading or a stray bullet marker, not a fact.
_MIN_FACT_CHARS = 12

#: Structural boundaries an author put there deliberately: blank lines,
#: markdown bullets, numbered lists. UNCHANGED.
#:
#: A bare `\n` was tried here and reverted: a single newline is just as often a
#: soft wrap INSIDE a sentence, and splitting on it turned
#: "She lost   her\n  job in March." into two fragments — inventing a claim the
#: author did not make. The sentence pass below handles real paragraph breaks
#: anyway, because `\s` matches the newline that follows the full stop.
_SPLIT_RE = re.compile(r"\n\s*\n|\n\s*[-*•]\s+|\n\s*\d+[.)]\s+")

#: Sentence boundaries, applied to whatever survives the structural pass.
#:
#: MEASURED, NOT ASSUMED. `chunk_text` used to stop at structural boundaries on
#: the theory that "the paragraph and the bullet already mark where one fact
#: ends". Prod says otherwise: a prose backstory yielded `backstory pool built:
#: 1 fact(s)`, so `SALIENT_BACKSTORY_CAP` selected from a pool of one and the
#: block rendered the ENTIRE profile every turn — 1723 chars, 64% of the block,
#: uncached. The whole premise of the feature ("recalled backstory instead of
#: the whole profile") was inverted, and every scoring tier in `recall.py`
#: — decay, cue matching, spreading activation, embeddings — was ranking a
#: single blob.
#:
#: Sentence-level, not finer: a clause fragment WOULD invent claims the author
#: did not make, which is the risk the original docstring was right about. A
#: whole sentence is the smallest unit that still stands on its own.
#:
#: Includes the Devanagari danda (।) and its double (॥) — a translated or
#: natively-authored Indic profile has no full stops to split on.
_SENTENCE_RE = re.compile(r"(?<=[.!?।॥])\s+")

#: Last resort. Text with no structural AND no sentence punctuation (a
#: run-on, or a script this regex does not know) would otherwise come back as
#: one blob again — the exact failure this fix exists to remove. Split on word
#: boundaries so a fact is never cut mid-word.
_HARD_MAX_FACT_CHARS = 220

#: Markdown heading / emphasis noise to strip from a chunk's edges.
_TRIM_RE = re.compile(r"^[#>\s*_`-]+|[\s*_`]+$")


@dataclass
class BackstoryCorpus:
    """Immutable per-session pool of recallable facts."""

    facts: List[Fact] = field(default_factory=list)
    #: chunk text -> embedding. Keyed by text because a Fact has no id; the
    #: text IS the identity here, the same way `_fold_facts` treats it.
    vectors: Dict[str, Sequence[float]] = field(default_factory=dict)

    def __bool__(self) -> bool:
        return bool(self.facts)


def _coalesce_short(sentences: Iterable[str]) -> List[str]:
    """Clean each sentence, and never let a short one vanish on its own.

    `_MIN_FACT_CHARS` exists to drop headings and stray bullet markers. Once
    the splitter went sentence-level that filter started deleting real content:
    "He is 17. He reads at night, whatever he can find." kept the second
    sentence and DROPPED the first, because "He is 17." is nine characters.
    Before sentence splitting the pair was one chunk and survived whole, so the
    client's age silently left the recall pool — a fact the author wrote, gone,
    with nothing to show it.

    A sub-minimum sentence is therefore merged into its neighbour (forward by
    preference, backward when it is last) rather than discarded. Merging stays
    INSIDE one structural chunk, so two short bullets are never fused into a
    compound fact the author never wrote — a lone short bullet still falls to
    the minimum, which is the pre-existing behaviour and a separate question.
    """
    cleaned: List[str] = []
    for sentence in sentences:
        text = _TRIM_RE.sub("", (sentence or "").strip())
        text = " ".join(text.split())
        if text:
            cleaned.append(text)

    merged: List[str] = []
    pending = ""
    for text in cleaned:
        candidate = f"{pending} {text}".strip() if pending else text
        if len(candidate) < _MIN_FACT_CHARS:
            pending = candidate
            continue
        merged.append(candidate)
        pending = ""
    if pending:
        if merged:
            merged[-1] = f"{merged[-1]} {pending}"
        else:
            # The whole chunk is under the minimum — a heading. Hand it on and
            # let the caller's filter drop it, as it always did.
            merged.append(pending)
    return merged


def _hard_wrap(chunk: str) -> List[str]:
    """Split on word boundaries when nothing else would split at all."""
    if len(chunk) <= _HARD_MAX_FACT_CHARS:
        return [chunk]
    pieces: List[str] = []
    current = ""
    for word in chunk.split(" "):
        if current and len(current) + 1 + len(word) > _HARD_MAX_FACT_CHARS:
            pieces.append(current)
            current = word
        else:
            current = f"{current} {word}".strip()
    if current:
        pieces.append(current)
    return pieces


def chunk_text(text: Optional[str]) -> List[str]:
    """Split authored prose into atomic, self-contained facts.

    Three passes, widest boundary first, each only doing what the one before
    it could not: structural (what the author marked) -> sentence -> hard wrap.

    The original was structural-only, on the theory that a human-written
    profile already marks where a fact ends. Production disproved it: a prose
    backstory produced ONE fact of 1721 chars, so the recall pool had a single
    member and the block rendered the whole profile every turn. Sentences are
    where it stops — finer would invent claims the author did not make.
    """
    if not text or not text.strip():
        return []
    out: List[str] = []
    seen: set[str] = set()
    for raw in _SPLIT_RE.split(text):
        for cleaned in _coalesce_short(_SENTENCE_RE.split(raw or "")):
            for chunk in _hard_wrap(cleaned):
                if len(chunk) < _MIN_FACT_CHARS:
                    continue
                key = chunk.lower()
                if key in seen:
                    continue
                seen.add(key)
                out.append(chunk)
    return out


def build_corpus(
    *,
    character_profile_text: Optional[str] = None,
    retrieved_context: Optional[str] = None,
    encoding_strength_profile: float = 1.0,
    encoding_strength_retrieved: float = 0.8,
) -> BackstoryCorpus:
    """Pool both sources into one ranked-together candidate set.

    Retrieved knowledge is seeded slightly weaker than the client's own life,
    and the asymmetry is the point rather than a tuning knob: when a case-file
    detail and a personal memory are equally relevant, the person remembers
    their own life first. Ties should not break toward the document.
    """
    facts: List[Fact] = []
    seen: set[str] = set()

    for text, strength in (
        (character_profile_text, encoding_strength_profile),
        (retrieved_context, encoding_strength_retrieved),
    ):
        for chunk in chunk_text(text):
            key = chunk.lower()
            if key in seen:
                continue
            seen.add(key)
            facts.append(Fact(text=chunk, encoding_strength=strength))
            if len(facts) >= MAX_POOL_FACTS:
                break
        if len(facts) >= MAX_POOL_FACTS:
            logger.info(
                "[working-memory] backstory pool hit the %d-fact cap; "
                "later material is not recallable",
                MAX_POOL_FACTS,
            )
            break

    logger.info("[working-memory] backstory pool built: %d fact(s)", len(facts))
    return BackstoryCorpus(facts=facts)


async def attach_vectors(
    corpus: BackstoryCorpus,
    embed_many,
) -> BackstoryCorpus:
    """Embed the pool ONCE, at session setup. Never raises.

    `embed_many` takes a list of strings and returns a list of vectors. On any
    failure the corpus is returned unchanged and recall stays lexical — which is
    `persona_bible`'s fallback exactly, and a degradation nobody hears.
    """
    if not corpus.facts:
        return corpus
    texts = [f.text for f in corpus.facts]
    try:
        vectors = await embed_many(texts)
    except Exception as exc:  # noqa: BLE001 - lexical recall is a fine fallback
        logger.warning(
            "[working-memory] pool embedding failed (%s); recall stays lexical",
            exc,
        )
        return corpus
    if not vectors or len(vectors) != len(texts):
        logger.warning(
            "[working-memory] pool embedding returned %s vectors for %d facts; "
            "recall stays lexical",
            len(vectors) if vectors else 0,
            len(texts),
        )
        return corpus
    # Coerced to plain float lists, not stored as returned. The embedding client
    # hands back numpy arrays, and `_cosine` opens with `if not a or not b` —
    # which raises "truth value of an array is ambiguous" on an ndarray. That
    # would surface as recall silently failing inside a detached task, i.e. the
    # hardest possible place to notice it.
    coerced: Dict[str, Sequence[float]] = {}
    for text, vector in zip(texts, vectors):
        try:
            values = [float(x) for x in vector]
        except TypeError:
            continue
        if values:
            coerced[text] = values
    corpus.vectors = coerced
    logger.info("[working-memory] pool embedded: %d vector(s)", len(corpus.vectors))
    return corpus
