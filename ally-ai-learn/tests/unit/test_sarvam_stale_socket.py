"""The Sarvam TTS pool must not hand out a WebSocket Sarvam already dropped."""

from types import SimpleNamespace

from app.tts.sarvam import _websocket_alive, guard_stale_websockets


def ws(transport_state: str | None, closed: bool = False):
    """A fake aiohttp ClientWebSocketResponse with the given transport."""
    transport = (
        None
        if transport_state is None
        else SimpleNamespace(is_closing=lambda: transport_state == "closing")
    )
    return SimpleNamespace(
        closed=closed,
        _response=SimpleNamespace(connection=SimpleNamespace(transport=transport)),
    )


class FakePool:
    def __init__(self, conns):
        self._queue = list(conns)
        self.removed = []

    async def get(self, *, timeout):
        return self._queue.pop(0)

    def remove(self, conn):
        self.removed.append(conn)


def test_liveness():
    assert _websocket_alive(ws("open"))
    # Sarvam's idle close: aiohttp still says closed=False, transport is gone.
    assert not _websocket_alive(ws(None))
    assert not _websocket_alive(ws("closing"))
    assert not _websocket_alive(ws("open", closed=True))
    # An unfamiliar aiohttp layout keeps the old behaviour (assume alive).
    assert _websocket_alive(SimpleNamespace(closed=False))


async def test_guard_discards_dead_sockets_and_returns_a_live_one():
    dead, fresh = ws(None), ws("open")
    pool = FakePool([dead, fresh])
    tts = SimpleNamespace(_pool=pool)

    guard_stale_websockets(tts)

    assert await pool.get(timeout=1) is fresh
    assert pool.removed == [dead]


async def test_guard_gives_up_after_the_limit():
    conns = [ws(None) for _ in range(4)]
    pool = FakePool(conns)
    guard_stale_websockets(SimpleNamespace(_pool=pool))

    # Three discarded, then the pool's own answer is returned and the plugin's
    # retry deals with it — never an endless loop.
    assert await pool.get(timeout=1) is conns[3]
    assert pool.removed == conns[:3]


async def test_guard_is_idempotent_and_tolerates_no_pool():
    live = ws("open")
    pool = FakePool([live])
    tts = SimpleNamespace(_pool=pool)
    guard_stale_websockets(tts)
    wrapped = pool.get
    guard_stale_websockets(tts)
    assert pool.get is wrapped
    assert await pool.get(timeout=1) is live
    guard_stale_websockets(SimpleNamespace())  # no _pool: no-op
