"""The knowledge-title selector, measured against the REAL model.

A fake LLM cannot catch this class of bug: the failure is the model's judgement
of relevance, not the plumbing. So this drives `retrieve_relevant_knowledge`
with the production prompt and the production client (gpt-4o-mini through
`OpenAILLMClient`, same temperature the agent inherits) over a conversation
recorded from a local v2v run, and scores it the way a retrieval component is
scored: did the expected memory come back, and did an irrelevant one not.

Skipped without LIVE_OPENAI_API_KEY (not OPENAI_API_KEY: the test conftest
replaces that with a dummy so nothing else can call out). Run it on purpose:

    LIVE_OPENAI_API_KEY=sk-... poetry run pytest \
        tests/integration/test_knowledge_selector_live.py -m openai_api --no-cov -s
"""

import json
import os
from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph import knowledge_retrieval
from app.core.graph.knowledge_retrieval import (
    build_knowledge_map,
    retrieve_relevant_knowledge,
)

pytestmark = [
    pytest.mark.openai_api,
    pytest.mark.skipif(
        not os.environ.get("LIVE_OPENAI_API_KEY"), reason="needs LIVE_OPENAI_API_KEY"
    ),
]

FIXTURE = json.loads(
    (
        Path(__file__).parent.parent
        / "fixtures"
        / "knowledge_selector"
        / "devika_family.json"
    ).read_text()
)

#: Each case is sampled this many times: the selector inherits the agent's
#: temperature, so a single call is an anecdote.
REPEATS = 3


def _messages(upto: int):
    out = []
    for turn in FIXTURE["conversation"][: upto + 1]:
        cls = AIMessage if turn["role"] == "client" else HumanMessage
        out.append(cls(content=turn["content"]))
    return out


def _client():
    from app.llms.openai import OpenAILLMClient

    return OpenAILLMClient(
        model="gpt-4o-mini",
        language_code="en-IN",
        api_key=os.environ["LIVE_OPENAI_API_KEY"],
    )


def _selected_titles(context: str, titles):
    return [t for t in titles if f"**{t}:**" in context]


@pytest.mark.asyncio
@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
async def test_selector_recalls_the_memory_the_conversation_is_about(case, monkeypatch):
    # The selector swallows every error and returns "" — indistinguishable from
    # "nothing relevant", which would make a broken call pass the precision
    # cases. Make any swallowed error fail the test instead.
    def _raise(msg, *args, **kwargs):
        raise AssertionError(f"selector call failed: {msg}")

    monkeypatch.setattr(knowledge_retrieval.logger, "exception", _raise)
    knowledge_map = build_knowledge_map(FIXTURE["knowledgeSources"])
    titles = list(knowledge_map)
    client = _client()
    hits, violations, picks = 0, 0, []
    for _ in range(REPEATS):
        knowledge_retrieval._RETRIEVAL_CACHE.clear()
        context = await retrieve_relevant_knowledge(
            client, _messages(case["upto"]), knowledge_map
        )
        chosen = _selected_titles(context, titles)
        picks.append(chosen)
        if not case["expect_any"] or set(chosen) & set(case["expect_any"]):
            hits += 1
        if set(chosen) & set(case["forbid"]):
            violations += 1
    print(f"\n[{case['name']}] picks={picks}")
    assert hits >= REPEATS - 1, f"expected one of {case['expect_any']}; got {picks}"
    assert violations == 0, f"selected a forbidden memory {case['forbid']}: {picks}"
