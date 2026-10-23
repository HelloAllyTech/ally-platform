"""Ranking of pre-rendered takes (scripts/pregenerate_voice_clips.py)."""

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

_PATH = Path(__file__).resolve().parents[2] / "scripts" / "pregenerate_voice_clips.py"


@pytest.fixture(scope="module")
def pregen():
    spec = importlib.util.spec_from_file_location("pregen", _PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["pregen"] = module
    spec.loader.exec_module(module)
    return module


def _take(ms, amp=8000, tag=0):
    n = int(48 * ms)
    samples = np.full(n, amp, dtype="<i2")
    samples[0] = tag  # distinguishes takes for the fake embedder
    return samples.tobytes()


class _Embedder:
    """Similarity is whatever the take's first sample says, scaled."""

    def embed(self, pcm):
        tag = np.frombuffer(pcm[:2], dtype="<i2")[0]
        return np.array([tag / 100.0, 0.0])


def test_long_takes_rank_by_similarity_to_the_voice(pregen):
    ref = np.array([1.0, 0.0])
    near = _take(2000, tag=80)
    far = _take(2000, tag=10)
    ranked = pregen.rank_takes([far, near, _take(2000, tag=40)], ref, 78.0, _Embedder())
    assert ranked[0][2] == near and ranked[-1][2] == far


def test_short_takes_ignore_similarity_and_drop_the_outlier(pregen):
    """A half-second hum's embedding is noise; the odd one out goes last."""
    ref = np.array([1.0, 0.0])
    typical = [_take(450, tag=0), _take(470, tag=1)]
    runon = _take(1400, tag=99)  # high "similarity", but 3x the others' length
    ranked = pregen.rank_takes(typical + [runon], ref, 78.0, _Embedder())
    assert ranked[-1][2] == runon


def test_fbank_shape_and_normalisation(pregen):
    audio = (np.sin(np.arange(48000) / 10.0) * 8000).astype(np.float64)
    feats = pregen._fbank(audio)
    assert feats.shape[1] == 80 and feats.shape[0] > 90
    assert np.allclose(feats.mean(axis=0), 0.0, atol=1e-4)
