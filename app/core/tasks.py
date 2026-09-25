"""Safe scheduling of fire-and-forget background work.

`asyncio.create_task(coro())` builds the coroutine *before* create_task ever
sees it. Called off the loop, create_task raises and that coroutine is left
un-awaited: the work is silently dropped, and Python only reports it at some
later GC pass — typically far from the call site — as
``RuntimeWarning: coroutine '...' was never awaited``.

`spawn_background_task` closes that gap: it disposes of the coroutine when it
cannot be scheduled, keeps a strong reference while the task is pending (asyncio
holds only a weak one), and logs the failure of a task nobody ever awaits
instead of letting it disappear.
"""

from __future__ import annotations

import asyncio
from typing import Any, Coroutine, Optional, Set

from app.core.logger import get_logger

logger = get_logger(__name__)


def spawn_background_task(
    coro: Coroutine[Any, Any, Any],
    *,
    name: str,
    background_tasks: Optional[Set["asyncio.Task"]] = None,
) -> Optional["asyncio.Task"]:
    """Schedule ``coro`` on the running loop, tracked and with failures logged.

    Args:
        coro: The coroutine to run in the background.
        name: Short label for this work, used in the task name and in logs.
        background_tasks: Optional set holding strong references to pending
            tasks (the worker's ``self._background_tasks`` convention). The
            task removes itself when it finishes.

    Returns:
        The scheduled task, or ``None`` when there is no running event loop —
        in which case ``coro`` is closed rather than abandoned, so the drop is
        logged once, here, instead of surfacing later as a RuntimeWarning.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        coro.close()
        logger.error("[background-task] %s dropped: no running event loop", name)
        return None

    task = asyncio.create_task(coro, name=name)
    if background_tasks is not None:
        background_tasks.add(task)

    def _on_done(finished: "asyncio.Task") -> None:
        if background_tasks is not None:
            background_tasks.discard(finished)
        if finished.cancelled():
            return
        exc = finished.exception()
        if exc is not None:
            # Nobody awaits these, so without this the failure is invisible
            # until the GC reports "Task exception was never retrieved".
            logger.error("[background-task] %s failed: %r", name, exc, exc_info=exc)

    task.add_done_callback(_on_done)
    return task
