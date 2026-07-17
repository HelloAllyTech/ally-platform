"""Tests for v2 runtime improvements: semantic retrieval (O7), static filler
fallback (O8), and the hardened specFetch retry path (O17)."""

import pytest

from app.roleplay_v2.actor.retrieval.persona_bible import (
    build_semantic_retriever,
    rank_chunks_semantic,
)
from app.roleplay_v2.spec.models import RoleplaySpecEnvelope, ScenarioSpec

# asyncio mode=auto (pytest.ini) runs async tests without an explicit mark.


# ---------------------------------------------------------------------------
# O7 — semantic ranking
# ---------------------------------------------------------------------------


class TestSemanticRetrieval:
    def _vecs_for(self, spec):
        # A trivial fake embedding space: one axis per chunk id. The query
        # vector points at whichever chunk we want ranked first.
        ids = [c.id for c in spec.persona.chunks]
        index = {cid: i for i, cid in enumerate(ids)}
        return ids, index

    def test_ranks_by_similarity(self, sample_spec):
        ids, index = self._vecs_for(sample_spec)
        dim = len(ids)

        def onehot(cid):
            v = [0.0] * dim
            v[index[cid]] = 1.0
            return v

        chunk_vecs = {cid: onehot(cid) for cid in ids}
        target = ids[2]
        ranked = rank_chunks_semantic(
            sample_spec.persona.chunks, onehot(target), chunk_vecs
        )
        assert ranked[0].id == target

    def test_semantic_retriever_falls_back_on_error(self, sample_spec):
        def boom(_text):
            raise RuntimeError("embedder down")

        retriever = build_semantic_retriever(boom, {})
        # Falls back to lexical select_chunks → still returns chunks, no raise.
        out = retriever(sample_spec, None, "work stress and sleep")
        assert out  # lexical fallback produced grounding

    def test_semantic_retriever_boosts_director_topics(self, sample_spec):
        ids, index = self._vecs_for(sample_spec)
        dim = len(ids)
        # All chunks embed identically → similarity is a tie; the Director-topic
        # boost must break the tie toward the nominated chunk.
        flat = [1.0] * dim
        chunk_vecs = {cid: flat for cid in ids}
        nominated_chunk = sample_spec.persona.chunks[-1]
        topic = nominated_chunk.topics[0]

        def embed(_q):
            return flat

        retriever = build_semantic_retriever(embed, chunk_vecs)
        out = retriever(sample_spec, [topic], None)
        assert out[0].id == nominated_chunk.id


# ---------------------------------------------------------------------------
# O8 — static filler phrases
# ---------------------------------------------------------------------------


class TestFillerPhrases:
    def test_spec_parses_filler_phrases_alias(self, sample_spec_dict):
        d = dict(sample_spec_dict)
        d["fillerPhrases"] = ["hmm", "let me think"]
        spec = ScenarioSpec.model_validate(d)
        assert spec.filler_phrases == ["hmm", "let me think"]

    def test_default_filler_phrases_non_empty(self):
        from app.worker_v2 import DEFAULT_V2_FILLER_PHRASES

        assert DEFAULT_V2_FILLER_PHRASES  # v2 has working fillers by default


# ---------------------------------------------------------------------------
# O17 — specFetch retry
# ---------------------------------------------------------------------------


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FlakyClient:
    """Async context-manager client that fails the first N gets, then succeeds."""

    fail_count = 0
    payload = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None):
        if _FlakyClient.fail_count > 0:
            _FlakyClient.fail_count -= 1
            raise RuntimeError("transient")
        return _FakeResp(_FlakyClient.payload)


class TestSpecFetchRetry:
    async def test_retries_then_succeeds(self, sample_envelope_dict, monkeypatch):
        import httpx

        spec_doc = sample_envelope_dict["spec"]
        env_dict = {
            "engine": "roleplay_v2",
            "specFetch": {"versionId": "v1", "url": "https://x/spec"},
            "session": sample_envelope_dict.get("session", {}),
        }
        envelope = RoleplaySpecEnvelope.model_validate(env_dict)
        assert envelope.spec is None

        _FlakyClient.fail_count = 2
        _FlakyClient.payload = spec_doc
        monkeypatch.setattr(httpx, "AsyncClient", _FlakyClient)
        monkeypatch.setattr("asyncio.sleep", _noop_sleep)

        spec = await envelope.ensure_spec()
        assert isinstance(spec, ScenarioSpec)
        assert spec.title == spec_doc["title"]

    async def test_raises_after_exhausting_attempts(
        self, sample_envelope_dict, monkeypatch
    ):
        import httpx

        env_dict = {
            "engine": "roleplay_v2",
            "specFetch": {"versionId": "v1", "url": "https://x/spec"},
            "session": sample_envelope_dict.get("session", {}),
        }
        envelope = RoleplaySpecEnvelope.model_validate(env_dict)

        _FlakyClient.fail_count = 99
        monkeypatch.setattr(httpx, "AsyncClient", _FlakyClient)
        monkeypatch.setattr("asyncio.sleep", _noop_sleep)

        with pytest.raises(RuntimeError):
            await envelope.ensure_spec()


async def _noop_sleep(*_args, **_kwargs):
    return None


# ---------------------------------------------------------------------------
# O5 — judge soft-dimension multi-sampling
# ---------------------------------------------------------------------------


class _ScriptedJudgeLLM:
    def __init__(self, judgements):
        self._judgements = list(judgements)

    def with_structured_output(self, schema, **kwargs):
        return self

    async def ainvoke(self, messages, **kwargs):
        return self._judgements.pop(0)


class TestJudgeMultiSample:
    async def test_soft_dimensions_averaged(self, sample_spec):
        from app.roleplay_v2.rehearsal.judge import (
            RehearsalSessionJudgement,
            judge_session,
        )

        j1 = RehearsalSessionJudgement(
            persona_consistency=60,
            difficulty_calibration=40,
            disclosure_discipline=100,
            rubric_coverage=50,
        )
        j2 = RehearsalSessionJudgement(
            persona_consistency=80,
            difficulty_calibration=60,
            disclosure_discipline=100,
            rubric_coverage=50,
        )
        llm = _ScriptedJudgeLLM([j1, j2])
        out = await judge_session(sample_spec, "POOR", [], [], llm, samples=2)
        assert out.persona_consistency == 70  # mean(60, 80)
        assert out.difficulty_calibration == 50  # mean(40, 60)
