"""Tests for app.core.tasks.spawn_background_task."""

import asyncio
import inspect

import pytest

from app.core.tasks import spawn_background_task


class TestSpawnBackgroundTask:
    def test_closes_the_coroutine_when_there_is_no_running_loop(self, caplog):
        """The whole point: never abandon a coroutine.

        An abandoned coroutine never runs and Python reports it at some later
        GC pass as "coroutine ... was never awaited", nowhere near the code
        that dropped it.
        """
        ran = []

        async def _work():
            ran.append(True)

        coro = _work()
        with caplog.at_level("ERROR"):
            task = spawn_background_task(coro, name="unit-work")

        assert task is None
        assert inspect.getcoroutinestate(coro) == inspect.CORO_CLOSED
        assert not ran
        assert any("unit-work" in r.getMessage() for r in caplog.records)

    @pytest.mark.asyncio
    async def test_runs_and_tracks_the_task(self):
        ran = asyncio.Event()

        async def _work():
            ran.set()

        tracked: set = set()
        task = spawn_background_task(
            _work(), name="unit-work", background_tasks=tracked
        )

        assert task in tracked
        assert task.get_name() == "unit-work"
        await task
        await asyncio.sleep(0)  # let the done-callback run
        assert ran.is_set()
        assert not tracked, "finished task must remove itself from the set"

    @pytest.mark.asyncio
    async def test_logs_a_failure_nobody_awaits(self, caplog):
        """Fire-and-forget failures must not vanish silently."""

        async def _boom():
            raise ValueError("background blew up")

        tracked: set = set()
        with caplog.at_level("ERROR"):
            task = spawn_background_task(
                _boom(), name="unit-boom", background_tasks=tracked
            )
            await asyncio.gather(task, return_exceptions=True)
            await asyncio.sleep(0)

        assert any(
            "unit-boom" in r.getMessage() and "background blew up" in r.getMessage()
            for r in caplog.records
        )
        assert not tracked

    @pytest.mark.asyncio
    async def test_cancellation_is_not_logged_as_a_failure(self, caplog):
        async def _work():
            await asyncio.sleep(3600)

        tracked: set = set()
        with caplog.at_level("ERROR"):
            task = spawn_background_task(
                _work(), name="unit-cancel", background_tasks=tracked
            )
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await asyncio.sleep(0)

        assert not [r for r in caplog.records if "unit-cancel" in r.getMessage()]
        assert not tracked
