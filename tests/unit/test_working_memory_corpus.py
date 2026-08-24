"""Phase 6: the pool salient_backstory is recalled from, and the fold.

Until this landed, `recall.select` had nothing to select from and the block
rendered "(nothing from your own life is on your mind this turn)" every turn.
The claim under test is §7.1's: a persona should be RECALLED, not dumped.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.working_memory import consolidate as mod
from app.core.working_memory.corpus import (
    MAX_POOL_FACTS,
    attach_vectors,
    build_corpus,
    chunk_text,
)
from app.core.working_memory.proposal import ValidatedUpdate
from app.core.working_memory.recall import select
from app.core.working_memory.state import ClientWorkingMemory, Fact
from app.core.working_memory.store import ClientWorkingMemoryStore

pytestmark = pytest.mark.unit


class TestChunking:
    def test_splits_paragraphs(self):
        assert chunk_text("She lost her job in March.\n\nHer mother is ill.") == [
            "She lost her job in March.",
            "Her mother is ill.",
        ]

    def test_splits_bullets_and_strips_markers(self):
        out = chunk_text("Background:\n- lost the job in March\n- mother is ill")
        assert "lost the job in March" in out
        assert not any(c.startswith("-") for c in out)

    def test_drops_headings_and_fragments(self):
        # "## Background" is a label, not a fact the client can remember.
        assert chunk_text("## Background\n\nShe lost her job in March.") == [
            "She lost her job in March."
        ]

    def test_dedupes(self):
        assert len(chunk_text("Same fact here.\n\nSame fact here.")) == 1

    def test_empty_input(self):
        assert chunk_text(None) == []
        assert chunk_text("   ") == []

    def test_collapses_internal_whitespace(self):
        assert chunk_text("She lost   her\n  job in March.") == [
            "She lost her job in March."
        ]


class TestBuildCorpus:
    def test_pools_both_sources(self):
        corpus = build_corpus(
            character_profile_text="She lost her job in March.",
            retrieved_context="The clinic closes at six.",
        )
        assert [f.text for f in corpus.facts] == [
            "She lost her job in March.",
            "The clinic closes at six.",
        ]

    def test_own_life_outranks_the_case_file_on_a_tie(self):
        # Not a tuning knob: when a personal memory and a document detail are
        # equally relevant, a person remembers their own life first.
        corpus = build_corpus(
            character_profile_text="Her mother is ill.",
            retrieved_context="Her mother is ill too.",
        )
        profile, retrieved = corpus.facts
        assert profile.encoding_strength > retrieved.encoding_strength

    def test_caps_the_pool(self):
        text = "\n\n".join(f"Fact number {i} about her life." for i in range(400))
        assert len(build_corpus(character_profile_text=text).facts) == MAX_POOL_FACTS

    def test_no_sources_is_falsy(self):
        assert not build_corpus()

    def test_dedupes_across_sources(self):
        corpus = build_corpus(
            character_profile_text="Her mother is ill.",
            retrieved_context="Her mother is ill.",
        )
        assert len(corpus.facts) == 1


class TestVectors:
    async def test_attaches_vectors(self):
        corpus = build_corpus(
            character_profile_text="Lost the job in March.\n\nMother is unwell."
        )
        embed = AsyncMock(return_value=[[1.0, 0.0], [0.0, 1.0]])
        await attach_vectors(corpus, embed)
        assert len(corpus.vectors) == len(corpus.facts)

    async def test_embedding_failure_degrades_to_lexical(self):
        corpus = build_corpus(character_profile_text="Lost the job in March.")
        await attach_vectors(corpus, AsyncMock(side_effect=RuntimeError("no key")))
        assert corpus.vectors == {}
        assert corpus.facts  # the pool survives; only ranking is weaker

    async def test_length_mismatch_is_refused(self):
        corpus = build_corpus(
            character_profile_text="One fact here.\n\nTwo facts here."
        )
        await attach_vectors(corpus, AsyncMock(return_value=[[1.0, 0.0]]))
        assert corpus.vectors == {}

    async def test_empty_pool_short_circuits(self):
        embed = AsyncMock()
        await attach_vectors(build_corpus(), embed)
        embed.assert_not_called()


class TestSemanticTerm:
    def _facts(self):
        return [Fact(text="lost the job in March"), Fact(text="the clinic is far")]

    def test_similarity_promotes_without_a_keyword_match(self):
        facts = self._facts()
        vectors = {"lost the job in March": [1.0, 0.0], "the clinic is far": [0.0, 1.0]}
        selected, scored = select(
            facts,
            turn_index=5,
            stance="guarded",
            cues=["unrelated"],
            vectors=vectors,
            query_vec=[1.0, 0.0],
            cap=1,
        )
        assert selected[0].text == "lost the job in March"
        assert scored[0].similarity > 0.9

    def test_no_vectors_means_no_semantic_term(self):
        _, scored = select(self._facts(), turn_index=5, stance="guarded")
        assert all(s.similarity == 0.0 for s in scored)

    def test_a_literal_cue_outranks_a_vector(self):
        # The learner's actual words beat a vector's opinion about them — the
        # right order when the STT producing those words is unreliable.
        facts = self._facts()
        vectors = {"lost the job in March": [0.0, 1.0], "the clinic is far": [1.0, 0.0]}
        selected, _ = select(
            facts,
            turn_index=1,
            stance="guarded",
            cues=["job"],
            vectors=vectors,
            query_vec=[1.0, 0.0],
            cap=1,
        )
        assert selected[0].text == "lost the job in March"

    def test_mismatched_vector_length_scores_zero(self):
        _, scored = select(
            self._facts(),
            turn_index=1,
            stance="guarded",
            vectors={"lost the job in March": [1.0, 0.0, 0.0]},
            query_vec=[1.0, 0.0],
        )
        assert all(s.similarity == 0.0 for s in scored)


class TestFoldIntoTheUpdate:
    def _messages(self):
        return [
            HumanMessage(content="tell me about the job"),
            AIMessage(content="not much to say"),
        ]

    def test_selects_using_this_turn_cues(self):
        corpus = build_corpus(
            character_profile_text=(
                "She lost the job in March.\n\nHer flat is near the river."
            )
        )
        update = ValidatedUpdate(retrieve_cues=["job"])
        selected = mod._select_salient(
            corpus,
            update=update,
            memory=ClientWorkingMemory(turn_index=3),
            new_messages=self._messages(),
        )
        assert selected[0].text == "She lost the job in March."

    def test_no_corpus_returns_none_not_empty(self):
        # None means "not part of this update"; [] would assert the client is
        # thinking about nothing, which a scenario with no profile cannot know.
        assert (
            mod._select_salient(
                None,
                update=ValidatedUpdate(),
                memory=ClientWorkingMemory(turn_index=1),
                new_messages=self._messages(),
            )
            is None
        )

    def test_recall_re_encodes_the_fact(self):
        corpus = build_corpus(character_profile_text="She lost the job in March.")
        mod._select_salient(
            corpus,
            update=ValidatedUpdate(stance="testing", retrieve_cues=["job"]),
            memory=ClientWorkingMemory(turn_index=4),
            new_messages=self._messages(),
        )
        fact = corpus.facts[0]
        assert fact.last_recalled_turn == 4
        # The stance the update just DECIDED, not the one it started from.
        assert fact.stances_seen == ["testing"]

    def test_same_stance_twice_counts_once(self):
        # The spacing effect counts DISTINCT phases, not raw recurrences.
        corpus = build_corpus(character_profile_text="She lost the job in March.")
        for turn in (1, 2):
            mod._select_salient(
                corpus,
                update=ValidatedUpdate(retrieve_cues=["job"]),
                memory=ClientWorkingMemory(turn_index=turn),
                new_messages=self._messages(),
            )
        assert corpus.facts[0].stances_seen == ["guarded"]

    async def test_commits_in_one_write_with_the_state(self, monkeypatch):
        # commit() rejects a turn index at or below the last committed, so a
        # second write for the same turn would be silently discarded.
        monkeypatch.setattr(mod, "load_template", lambda *a, **k: "SYS")
        from app.core.working_memory.proposal import ProposedUpdate

        store = ClientWorkingMemoryStore()
        store.corpus = build_corpus(character_profile_text="She lost the job in March.")
        structured = AsyncMock()
        structured.ainvoke = AsyncMock(
            return_value={
                "parsed": ProposedUpdate(affect="tense", retrieve_cues=["job"]),
                "raw": None,
            }
        )
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)

        assert mod.schedule_update(
            store,
            memory=ClientWorkingMemory(turn_index=2),
            new_messages=self._messages(),
            llm_client=SimpleNamespace(llm_instance=llm_instance),
            timeout=5.0,
        )
        await store._task
        state = await store.snapshot()
        assert state.affect == "tense"
        assert [f.text for f in state.salient_backstory] == [
            "She lost the job in March."
        ]
        assert store.last_committed_turn == 2
