"""Passage selection: v1's band unchanged; the v2 agent's selection (chunk 20a-2) no
longer lets a heading-only chunk set the bar, and always offers a few passages that
clear the decline threshold. Scores are the yoga studio's from CHUNK-20A-EVAL.md."""

from app.core.knowledge_agent.agent import (
    AGENT_FLOOR_PASSAGES,
    AGENT_MIN_BEST_TOKENS,
    KnowledgeAgentService,
)

select = KnowledgeAgentService._select_passages
LIMITS = {"band": 0.08, "max_passages": 5, "max_context_tokens": 3000}
AGENT = {
    "min_best_tokens": AGENT_MIN_BEST_TOKENS,
    "floor_passages": AGENT_FLOOR_PASSAGES,
    "floor_similarity": 0.42,
}


def hit(chunk, similarity, tokens):
    return {"chunk_id": chunk, "similarity": similarity, "token_count": tokens}


YOGA = [
    hit("heading", 0.769, 4),  # "Prana Yoga Studio"
    hit("styles", 0.616, 40),  # "…teaches Hatha, Vinyasa and Yin yoga…"
    hit("teachers", 0.55, 30),
    hit("classes", 0.486, 60),
    hit("contact", 0.31, 25),
]


def ids(passages):
    return [p["chunk_id"] for p in passages]


def test_v1_keeps_its_band_exactly():
    assert ids(select(YOGA, **LIMITS)) == ["heading"]


def test_v2_heading_cannot_set_the_band_and_the_answer_is_offered():
    chosen = ids(select(YOGA, **LIMITS, **AGENT))
    assert "styles" in chosen and "classes" in chosen
    assert "contact" not in chosen  # below the decline threshold
    assert chosen == ["heading", "styles", "teachers", "classes"]


def test_v2_floor_never_goes_below_the_decline_threshold():
    weak = [hit("a", 0.6, 40), hit("b", 0.41, 40), hit("c", 0.40, 40)]
    assert ids(select(weak, **LIMITS, **AGENT)) == ["a"]


def test_v2_with_a_strong_full_chunk_on_top_is_the_band_plus_the_floor():
    hits = [
        hit("a", 0.80, 50),
        hit("b", 0.79, 50),
        hit("c", 0.60, 50),
        hit("d", 0.5, 50),
    ]
    assert ids(select(hits, **LIMITS, **AGENT)) == ["a", "b", "c", "d"]


def test_v2_still_caps_and_budgets():
    hits = [hit(str(n), 0.9 - n / 100, 900) for n in range(8)]
    chosen = select(hits, **{**LIMITS, "max_context_tokens": 2000}, **AGENT)
    assert len(chosen) == 2


def test_all_hits_short_falls_back_to_the_top_hit():
    hits = [hit("a", 0.7, 3), hit("b", 0.6, 3)]
    assert ids(select(hits, **LIMITS, **AGENT)) == ["a", "b"]
