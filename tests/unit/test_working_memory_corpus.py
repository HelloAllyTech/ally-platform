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

    @pytest.mark.asyncio
    async def test_selects_using_this_turn_cues(self):
        corpus = build_corpus(
            character_profile_text=(
                "She lost the job in March.\n\nHer flat is near the river."
            )
        )
        update = ValidatedUpdate(retrieve_cues=["job"])
        selected = await mod._select_salient(
            corpus,
            update=update,
            memory=ClientWorkingMemory(turn_index=3),
            new_messages=self._messages(),
        )
        assert selected[0].text == "She lost the job in March."

    @pytest.mark.asyncio
    async def test_no_corpus_returns_none_not_empty(self):
        # None means "not part of this update"; [] would assert the client is
        # thinking about nothing, which a scenario with no profile cannot know.
        assert (
            await mod._select_salient(
                None,
                update=ValidatedUpdate(),
                memory=ClientWorkingMemory(turn_index=1),
                new_messages=self._messages(),
            )
            is None
        )

    @pytest.mark.asyncio
    async def test_recall_re_encodes_the_fact(self):
        corpus = build_corpus(character_profile_text="She lost the job in March.")
        await mod._select_salient(
            corpus,
            update=ValidatedUpdate(stance="testing", retrieve_cues=["job"]),
            memory=ClientWorkingMemory(turn_index=4),
            new_messages=self._messages(),
        )
        fact = corpus.facts[0]
        assert fact.last_recalled_turn == 4
        # The stance the update just DECIDED, not the one it started from.
        assert fact.stances_seen == ["testing"]

    @pytest.mark.asyncio
    async def test_same_stance_twice_counts_once(self):
        # The spacing effect counts DISTINCT phases, not raw recurrences.
        corpus = build_corpus(character_profile_text="She lost the job in March.")
        for turn in (1, 2):
            await mod._select_salient(
                corpus,
                update=ValidatedUpdate(retrieve_cues=["job"]),
                memory=ClientWorkingMemory(turn_index=turn),
                new_messages=self._messages(),
            )
        assert corpus.facts[0].stances_seen == ["guarded"]

    @pytest.mark.asyncio
    async def test_commits_in_one_write_with_the_state(self, monkeypatch):
        # commit() rejects a turn index at or below the last committed, so a
        # second write for the same turn would be silently discarded.
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
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


class TestSemanticTierIsActuallyWired:
    """The semantic tier was written, tested in isolation, and called by nothing.

    Both halves were missing independently — `attach_vectors` had no caller, and
    the query vector was hardcoded None at the only call site — so either one
    alone kept it inert. These tests drive `schedule_update`, the real entry
    point, because the earlier tests exercised `_select_salient` directly and
    would have passed against a completely unwired feature.
    """

    def _messages(self):
        return [
            HumanMessage(content="what about the badminton you mentioned"),
            AIMessage(content="I stopped going"),
        ]

    def _llm(self, cues):
        from app.core.working_memory.proposal import ProposedUpdate

        structured = AsyncMock()
        structured.ainvoke = AsyncMock(
            return_value={
                "parsed": ProposedUpdate(affect="flat", retrieve_cues=cues),
                "raw": None,
            }
        )
        instance = MagicMock()
        instance.with_structured_output = MagicMock(return_value=structured)
        return SimpleNamespace(llm_instance=instance)

    async def test_embed_query_is_called_through_schedule_update(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        store = ClientWorkingMemoryStore()
        store.corpus = build_corpus(
            character_profile_text="She stopped going to Saturday badminton."
        )
        # A pool WITH vectors: the precondition for spending an embedding call.
        await attach_vectors(store.corpus, AsyncMock(return_value=[[1.0, 0.0]]))

        embed_query = AsyncMock(return_value=[1.0, 0.0])
        assert mod.schedule_update(
            store,
            memory=ClientWorkingMemory(turn_index=1),
            new_messages=self._messages(),
            llm_client=self._llm(["badminton"]),
            timeout=5.0,
            embed_query=embed_query,
        )
        await store._task
        embed_query.assert_awaited_once()
        assert "badminton" in embed_query.await_args.args[0]

    async def test_no_vectors_means_no_embedding_call(self, monkeypatch):
        # An unembedded pool ranks lexically, so paying for a query embedding
        # would buy a number nothing multiplies by.
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        store = ClientWorkingMemoryStore()
        store.corpus = build_corpus(character_profile_text="She stopped going.")
        embed_query = AsyncMock(return_value=[1.0, 0.0])
        mod.schedule_update(
            store,
            memory=ClientWorkingMemory(turn_index=1),
            new_messages=self._messages(),
            llm_client=self._llm(["badminton"]),
            timeout=5.0,
            embed_query=embed_query,
        )
        await store._task
        embed_query.assert_not_awaited()

    async def test_a_failing_embedder_still_recalls_lexically(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        store = ClientWorkingMemoryStore()
        store.corpus = build_corpus(
            character_profile_text="She stopped going to Saturday badminton."
        )
        await attach_vectors(store.corpus, AsyncMock(return_value=[[1.0, 0.0]]))
        mod.schedule_update(
            store,
            memory=ClientWorkingMemory(turn_index=1),
            new_messages=self._messages(),
            llm_client=self._llm(["badminton"]),
            timeout=5.0,
            embed_query=AsyncMock(side_effect=RuntimeError("no key")),
        )
        await store._task
        state = await store.snapshot()
        assert [f.text for f in state.salient_backstory] == [
            "She stopped going to Saturday badminton."
        ]

    async def test_numpy_vectors_do_not_break_cosine(self):
        # _cosine opens with `if not a or not b`, which RAISES on an ndarray —
        # and the embedding client returns ndarrays. Unfixed, this surfaced as
        # recall silently failing inside a detached task.
        import numpy as np

        corpus = build_corpus(character_profile_text="She stopped going to badminton.")
        await attach_vectors(corpus, AsyncMock(return_value=[np.array([0.6, 0.8])]))
        assert corpus.vectors
        vector = next(iter(corpus.vectors.values()))
        assert isinstance(vector, list)
        assert all(isinstance(x, float) for x in vector)


class TestProseChunking:
    """Prose backstories, which production showed were not being split at all."""

    PROSE = (
        "You are Rohan, 17, a first-year NEET student at ALLEN. "
        "By November your scores had fallen sharply.\n"
        "Your grandfather raised you. He died while you were here."
    )

    def test_prose_splits_into_sentences_not_one_blob(self):
        # Prod: `backstory pool built: 1 fact(s)` for a 1721-char profile, so
        # SALIENT_BACKSTORY_CAP selected from a pool of one and the block
        # rendered the whole profile every turn.
        facts = chunk_text(self.PROSE)
        assert len(facts) == 4
        assert "You are Rohan, 17, a first-year NEET student at ALLEN." in facts
        assert "Your grandfather raised you." in facts

    def test_a_newline_after_a_full_stop_is_a_boundary(self):
        # The paragraph break that the structural pass misses (single newline,
        # not blank line) is caught by the sentence pass, because \s matches it.
        facts = chunk_text("First thing happened.\nSecond thing happened.")
        assert facts == ["First thing happened.", "Second thing happened."]

    def test_a_soft_wrapped_sentence_is_NOT_split(self):
        # The regression guard: splitting on a bare newline invented a claim
        # the author never made by cutting a sentence in half.
        assert chunk_text("She lost   her\n  job in March.") == [
            "She lost her job in March."
        ]

    def test_indic_danda_is_a_sentence_boundary(self):
        # A translated or natively-authored Indic profile has no full stops.
        facts = chunk_text("आप रोहन हैं। दादाजी ने आपको पाला। वे भर्ती हुए थे।")
        assert len(facts) == 3
        assert facts[0] == "आप रोहन हैं।"

    def test_text_with_no_punctuation_still_bounded(self):
        # Last resort: without this a run-on comes back as one blob, which is
        # the exact failure being fixed.
        facts = chunk_text("word " * 200)
        assert len(facts) > 1
        assert all(len(f) <= 220 for f in facts)


class TestShortSentencesAreNotLost:
    """The regression sentence-splitting introduced, and its guard.

    `_MIN_FACT_CHARS` was written to drop headings. Applied per SENTENCE it
    started deleting real content instead: "He is 17." is nine characters, so
    the client's age silently left the recall pool — a fact the author wrote,
    gone, with nothing to show for it.
    """

    def test_a_short_first_sentence_merges_forward(self):
        assert chunk_text(
            "He is 17. He reads at night, whatever he can find, not textbooks."
        ) == ["He is 17. He reads at night, whatever he can find, not textbooks."]

    def test_a_short_middle_sentence_merges_forward(self):
        facts = chunk_text(
            "She is tired. She copes. "
            "Her mother calls every day and she does not answer."
        )
        assert any("She copes." in f for f in facts)

    def test_a_short_LAST_sentence_merges_backward(self):
        # Nothing follows it, so the only way to keep it is to attach it to
        # what came before.
        assert chunk_text("He reads at night, whatever he can find. He is 17.") == [
            "He reads at night, whatever he can find. He is 17."
        ]

    def test_merging_never_crosses_a_structural_boundary(self):
        # Two short bullets must not fuse into a compound fact the author never
        # wrote. A lone short bullet still falls to the minimum, which is the
        # behaviour that predates sentence splitting.
        facts = chunk_text("- likes tea\n- works nights and has not told anyone")
        assert facts == ["works nights and has not told anyone"]

    def test_a_heading_alone_is_still_dropped(self):
        assert chunk_text("## Background") == []
