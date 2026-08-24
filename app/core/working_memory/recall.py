"""Which memories the client currently has in mind.

Selection structure is salvaged from ``app/roleplay_v2/actor/retrieval/
persona_bible.py`` (design §9.1): three tiers, stem-tolerant cue matching,
cue hits weighted to dominate incidental prose overlap, a hard budget, and a
baseline so the actor is never left with nothing. What is added here is the
salience function from §7.4 — the reason a fact is or is not in mind.

    salience = encoding_strength
             × recency_decay(turns since last recall)      Ebbinghaus
             × phase_diversity(distinct stances seen)      spacing effect
             × cue_match(current cues)                     encoding specificity
             × mood_congruence(current stance)             Bower
             + spreading_activation(neighbours selected)   Collins & Loftus

**Every coefficient below is an invented starting point.** The effects are real
and named; these numbers are not measured. §7.8 says so and this module exists
partly to make them tunable from production — which is why `select` returns the
score of everything it considered, not just what it chose.

Two things deliberately NOT selected here:

- **Unresolved threads.** §7.4 exempts them from decay, and the cleanest way to
  honour that is structural: threads are not candidates at all. They render
  because they are open, not because they scored well.
- **The language glossary.** Vocabulary must not decay — a client does not
  forget how to speak their own language, which is the one place §7's memory
  analogy breaks (§9.2).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence

from app.core.logger import get_logger
from app.core.working_memory.state import SALIENT_BACKSTORY_CAP, Fact

logger = get_logger(__name__)

_WORD_RE = re.compile(r"[\w']+", re.UNICODE)

#: Minimum length when DERIVING cues from prose. Salvaged from persona_bible,
#: where it stops "the", "and", "you" from becoming retrieval signal.
_MIN_CUE_LEN = 4

#: Minimum length of a cue that may MATCH. Lower than the derivation floor
#: because an explicitly nominated cue is trusted and often short ("job",
#: "mum", "debt"); still bounded, or a one-character cue matches every fact.
_MIN_MATCHABLE_CUE_LEN = 3

# --- invented coefficients (§7.8). Tune from the telemetry, not from taste. ---

#: Ebbinghaus. Retention falls without rehearsal, and this is the EVICTION
#: policy: facts that stop being cued fade out, which is what keeps the block
#: concise by construction rather than by truncating arbitrarily.
_DECAY_PER_TURN = 0.05
#: Raised from 0.25 by a test that encoded the stated intent — "dormant, not
#: deleted". At 0.25 a fully-decayed but directly CUED fact scored 0.75 against
#: 1.0 for a fresh irrelevant one, so the conversation turning to a long-unused
#: memory would not surface it. The floor is the honest lever here; the cue
#: weight is doing its own job.
_DECAY_FLOOR = 0.4

#: Spacing effect. A fact raised three times in one stance is one rehearsal;
#: raised once in three stances it is durable. Counts DISTINCT stances.
_PHASE_BONUS_PER_STANCE = 0.35

#: Encoding specificity. Retrieval succeeds when the cue matches the encoding
#: context — the formal reason client-side cues work as a key where
#: counsellor-technique events do not (§4).
#:
#: This one is DERIVED rather than guessed, which makes it the least arbitrary
#: number in this module. §7.3 bounds encoding_strength at 3.0 (1.0 baseline
#: + 0.5 affect-laden + 0.5 deep processing + 1.0 opened a thread), so for a
#: single cue hit to lift the WEAKEST fact above the STRONGEST uncued one:
#:
#:     1.0 × (1 + w) > 3.0   ⇒   w > 2.0
#:
#: 2.5 clears it. The intent is §2's: everything being equally present is the
#: same as nothing being salient, so relevance to what is actually being
#: discussed has to outrank standing importance.
_CUE_MATCH_WEIGHT = 2.5

#: Bower. State biases accessibility: a guarded client should not have warm
#: memories equally available. Operationalised as "this fact was laid down in
#: the stance we are now in" rather than by inventing a valence lexicon, which
#: would need a per-language affect dictionary we do not have.
_MOOD_CONGRUENT_BONUS = 0.5

#: Collins & Loftus. Activating a concept primes its neighbours, so recall is
#: cheaper and more coherent than an independent top-k. Additive, and applied
#: after a first pass so it can only promote — never demote a cued fact.
_SPREADING_ACTIVATION = 0.4

#: Weight on semantic similarity, salvaged as a TERM rather than as a separate
#: ranking pass. persona_bible ran cosine as the whole score with a keyword
#: fallback; here it multiplies alongside decay, phase diversity and cue match,
#: because a fact can be semantically near the current topic and still be the
#: wrong thing to remember — stale, off-mood, or already said. Similarity is
#: evidence, not a verdict.
#:
#: 1.5 makes a perfectly-similar fact worth slightly less than a literal cue
#: match (_CUE_MATCH_WEIGHT 2.5): the learner's actual words outrank a vector's
#: opinion about them, which is the right order when the STT that produced those
#: words is itself unreliable for Indian languages.
_SEMANTIC_WEIGHT = 1.5


@dataclass
class ScoredFact:
    """A candidate and why it scored what it did — the telemetry §5.1 asks for."""

    fact: Fact
    score: float
    cue_hits: int
    mood_congruent: bool
    spread: bool = False
    #: Cosine against the turn's query, 0 when the pool is not embedded. Kept
    #: on the record for the same reason as the other terms: the weights are
    #: meant to be tuned from production, not from argument.
    similarity: float = 0.0


def _keywords(text: Optional[str]) -> set[str]:
    """Cues DERIVED from prose — length-filtered to drop function words."""
    if not text:
        return set()
    return {w.lower() for w in _WORD_RE.findall(text) if len(w) >= _MIN_CUE_LEN}


def _tokens(text: Optional[str]) -> set[str]:
    """Every word of a candidate, UNFILTERED.

    Deliberately not `_keywords`. That filter exists to stop function words
    becoming cues; applying it to the thing being matched instead made a short
    nominated cue unmatchable — "job" could never match "lost the job", because
    the fact's own three-letter word had been dropped before comparison.
    """
    if not text:
        return set()
    return {w.lower() for w in _WORD_RE.findall(text)}


def _stem_match_count(candidate_words: set[str], cues: set[str]) -> int:
    """Cue hits, tolerating simple inflections.

    Salvaged verbatim in spirit from persona_bible's `_stem_matches`:
    "sleeping" matches the cue "sleep", "layoffs" matches "layoff". Each cue can
    match at most once, so a repeated cue cannot inflate a single fact.
    """
    hits = 0
    for cue in cues:
        for word in candidate_words:
            if word == cue or word.startswith(cue) or cue.startswith(word):
                hits += 1
                break
    return hits


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity; 0 for a zero-length or mismatched vector.

    Salvaged from ``roleplay_v2/actor/retrieval/persona_bible.py`` (§9.1).
    Pure and network-free by design: the pool's vectors are computed once at
    session setup (see corpus.attach_vectors), so per-turn cost is arithmetic.
    """
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def _recency_decay(fact: Fact, turn_index: int) -> float:
    """Ebbinghaus decay on turns since last recall, floored.

    Floored rather than asymptotic to zero: a fact that has never been cued is
    dormant, not deleted, and a floor of zero would make it unreachable even
    when the conversation finally turns to it.
    """
    if fact.last_recalled_turn is None:
        return 1.0
    elapsed = max(0, turn_index - fact.last_recalled_turn)
    return max(_DECAY_FLOOR, 1.0 - _DECAY_PER_TURN * elapsed)


def score_fact(
    fact: Fact,
    *,
    turn_index: int,
    cues: set[str],
    stance: str,
    similarity: float = 0.0,
) -> ScoredFact:
    """Salience of one fact, with the terms kept separable for tuning.

    `similarity` is cosine against the turn's query when the pool is embedded,
    and 0 when it is not — so the lexical path is the semantic path with one
    term switched off, rather than a different code path to keep in step.
    """
    words = _tokens(fact.text)
    cue_hits = _stem_match_count(words, cues) if cues else 0
    mood_congruent = stance in fact.stances_seen

    distinct_stances = len(set(fact.stances_seen))
    score = (
        max(fact.encoding_strength, 0.0)
        * _recency_decay(fact, turn_index)
        * (1.0 + _PHASE_BONUS_PER_STANCE * distinct_stances)
        * (1.0 + _CUE_MATCH_WEIGHT * cue_hits)
        * (1.0 + _SEMANTIC_WEIGHT * max(similarity, 0.0))
        * (1.0 + (_MOOD_CONGRUENT_BONUS if mood_congruent else 0.0))
    )
    return ScoredFact(
        fact=fact,
        score=score,
        cue_hits=cue_hits,
        mood_congruent=mood_congruent,
        similarity=similarity,
    )


def select(
    candidates: Sequence[Fact],
    *,
    turn_index: int,
    stance: str,
    cues: Iterable[str] = (),
    last_learner_text: Optional[str] = None,
    cap: int = SALIENT_BACKSTORY_CAP,
    vectors: Optional[Dict[str, Sequence[float]]] = None,
    query_vec: Optional[Sequence[float]] = None,
) -> tuple[List[Fact], List[ScoredFact]]:
    """Pick what the client has in mind, and report every score considered.

    `cues` are the topics the off-path updater nominated for this turn —
    roleplay_v2's `retrieve_topics`. `last_learner_text` is the fallback when it
    nominated nothing, which is persona_bible's second tier: the conversation
    itself is a cue even when nothing has reasoned about it yet.

    Returns (selected, all_scored). The second element is what makes the
    coefficients above tunable from production rather than from argument.
    """
    if not candidates:
        return [], []

    cue_set = {
        c.strip().lower()
        for c in cues
        if c and len(c.strip()) >= _MIN_MATCHABLE_CUE_LEN
    }
    if not cue_set:
        # Tier 2 — no nomination, so read the learner's own words as the cue.
        cue_set = _keywords(last_learner_text)

    sims: Dict[str, float] = {}
    if vectors and query_vec:
        sims = {
            f.text: _cosine(query_vec, vectors.get(f.text) or ()) for f in candidates
        }

    scored = [
        score_fact(
            f,
            turn_index=turn_index,
            cues=cue_set,
            stance=stance,
            similarity=sims.get(f.text, 0.0),
        )
        for f in candidates
    ]

    # Spreading activation: a second pass that can only PROMOTE. Facts sharing
    # vocabulary with something already cued get a bump, so the selection hangs
    # together instead of being five unrelated top-k hits.
    primed: set[str] = set()
    for s in scored:
        if s.cue_hits:
            primed |= _keywords(s.fact.text)
    if primed:
        for s in scored:
            if not s.cue_hits and _stem_match_count(_tokens(s.fact.text), primed):
                s.score += _SPREADING_ACTIVATION
                s.spread = True

    # Stable ordering: score desc, then first-seen so a tie is resolved by the
    # older memory rather than by dict order.
    ranked = sorted(scored, key=lambda s: (-s.score, s.fact.first_seen_turn))

    # Tier 3 — baseline. If nothing scored above zero the client still needs
    # grounding, so take the strongest-encoded few rather than rendering an
    # empty block. persona_bible's "keep the persona grounded anyway".
    if all(s.score <= 0 for s in ranked):
        ranked = sorted(
            scored, key=lambda s: (-s.fact.encoding_strength, s.fact.first_seen_turn)
        )

    selected = [s.fact for s in ranked[: max(0, cap)]]

    logger.debug(
        "[working-memory] recall: cues=%s candidates=%d cue_hits=%d "
        "spread=%d selected=%d",
        sorted(cue_set),
        len(candidates),
        sum(1 for s in scored if s.cue_hits),
        sum(1 for s in scored if s.spread),
        len(selected),
    )
    return selected, ranked
