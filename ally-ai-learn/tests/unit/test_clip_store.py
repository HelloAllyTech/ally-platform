"""The persistent clip store: rendered once per voice, loaded by every session.

In prod every session started with an empty process cache and re-rendered its
whole opener catalog (cache_size == cache_misses in every session-totals line,
2026-09-29..10-01). These pin the store's contract: serve stored takes before
rendering, save a fresh render for the next session, and never let the store
fail a session.
"""

import io

import pytest

from app.core.livekit import clip_store, filler_clips
from app.core.livekit.filler_clips import synthesize_clips


class _FakeTTS:
    def __init__(self):
        self.calls = []

    def synthesize(self, text):
        self.calls.append(text)
        from tests.unit.test_filler_clips import _FakeFrame, _FakeStream

        return _FakeStream([_FakeFrame(b"\x40\x1f" * 7200, 24000, 1)])

    def stream(self):
        raise AssertionError("not used")

    async def aclose(self):
        pass


class _Client:
    def __init__(self):
        self.tts = _FakeTTS()
        self._voice = "v1"
        self._current_params = {}
        self._default_params = {}
        self._tts_instance = None

    def create_clip_tts(self):
        return self.tts


def _pcm(ms, amp=8000):
    return int(amp).to_bytes(2, "little", signed=True) * int(48 * ms)


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    monkeypatch.setattr(filler_clips, "_CACHE", filler_clips._ClipCache(50))
    monkeypatch.setattr(clip_store.settings, "CLIP_STORE_BUCKET", "bucket")
    saved = []
    monkeypatch.setattr(
        clip_store,
        "save_in_background",
        lambda fp, lang, text, pcm, take=0: saved.append((lang, text, len(pcm))),
    )
    return saved


@pytest.mark.asyncio
async def test_stored_takes_are_served_without_rendering(monkeypatch, _isolated):
    async def _load(fp, lang, texts):
        return {"Hmm.": [_pcm(400), _pcm(500), _pcm(450)]}

    monkeypatch.setattr(clip_store, "load_many", _load)
    client = _Client()
    clips = await synthesize_clips(client, ["Hmm."], language="en-IN")

    assert client.tts.calls == []  # nothing rendered
    assert clips[0].duration_ms == pytest.approx(400, abs=1)
    assert [round(d) for _, d in clips[0].alternates] == [500, 450]
    assert _isolated == []  # a store hit is not written back

    # The next session on this worker is served by the process cache.
    async def _boom(*a):
        raise AssertionError("store must not be hit again")

    monkeypatch.setattr(clip_store, "load_many", _boom)
    again = await synthesize_clips(client, ["Hmm."], language="en-IN")
    assert len(again[0].alternates) == 2


@pytest.mark.asyncio
async def test_a_miss_renders_and_saves_for_the_next_session(monkeypatch, _isolated):
    async def _load(fp, lang, texts):
        return {}

    monkeypatch.setattr(clip_store, "load_many", _load)
    client = _Client()
    clips = await synthesize_clips(client, ["Well…"], language="hi-IN")

    assert client.tts.calls == ["Well…"]
    assert len(clips) == 1 and clips[0].alternates == []
    assert _isolated == [("hi-IN", "Well…", 2 * 14400)]


@pytest.mark.asyncio
async def test_an_uncached_render_is_never_stored(monkeypatch, _isolated):
    """A bridge line is written for one moment; it must not fill the store."""

    async def _load(*a):
        raise AssertionError("bridges skip the store")

    monkeypatch.setattr(clip_store, "load_many", _load)
    await synthesize_clips(_Client(), ["That's a lot."], use_cache=False)
    assert _isolated == []


@pytest.mark.asyncio
async def test_a_failing_store_still_renders(monkeypatch):
    monkeypatch.setattr(
        clip_store, "_load_sync", lambda *a: (_ for _ in ()).throw(OSError("down"))
    )
    client = _Client()
    clips = await synthesize_clips(client, ["Hmm."], language="en-IN")
    assert client.tts.calls == ["Hmm."] and len(clips) == 1


def test_load_reads_takes_best_first_and_caps_them(monkeypatch):
    objects = {
        f"{clip_store.text_dir('fp', 'en', 'Hmm.')}/take-0{i}.pcm": bytes([i]) * 4
        for i in (3, 0, 2, 1)
    }

    class _S3:
        def list_objects_v2(self, Bucket, Prefix, MaxKeys):
            return {"Contents": [{"Key": k} for k in objects if k.startswith(Prefix)]}

        def get_object(self, Bucket, Key):
            return {"Body": io.BytesIO(objects[Key])}

    monkeypatch.setattr(clip_store, "_s3", lambda: _S3())
    takes = clip_store._load_sync("fp", "en", "Hmm.")
    assert [t[0] for t in takes] == [0, 1, 2]


def test_fingerprint_is_stable_across_instance_build_and_key_rotation():
    client = _Client()
    before = filler_clips.voice_fingerprint(client)
    client._tts_instance = object()
    client._api_key = "rotated"
    assert filler_clips.voice_fingerprint(client) == before
    client._voice = "v2"
    assert filler_clips.voice_fingerprint(client) != before


def test_disabled_without_a_bucket(monkeypatch):
    monkeypatch.setattr(clip_store.settings, "CLIP_STORE_BUCKET", "")
    assert not clip_store.enabled()


class TestTakeRotation:
    def test_an_opener_rotates_through_its_takes(self):
        from app.core.livekit.opener_player import OpenerPlayer

        player = OpenerPlayer.__new__(OpenerPlayer)
        player._plays = {}
        clip = filler_clips.FillerClip(
            phrase="Hmm.",
            frames=["a"],
            duration_ms=400.0,
            alternates=[(["b"], 500.0), (["c"], 450.0)],
        )
        heard = [player._next_take("hmm", clip).frames for _ in range(4)]
        assert heard == [["a"], ["b"], ["c"], ["a"]]
