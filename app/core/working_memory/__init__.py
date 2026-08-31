"""The client's working memory — one rolling structured context.

See docs/client-working-memory-design.md. This package is the phase-2 salvage:
the runtime plumbing lifted out of the since-removed ``app/roleplay_v2``
and generalised away from
``ScenarioSpec``, with nothing reading it yet. The derivation layer that fills it
is phase 3.
"""

from app.core.working_memory.corpus import BackstoryCorpus, build_corpus
from app.core.working_memory.state import (
    STANCES,
    ClientWorkingMemory,
    Fact,
    Stance,
    Thread,
    WithheldTopic,
)
from app.core.working_memory.store import ClientWorkingMemoryStore

__all__ = [
    "ClientWorkingMemory",
    "ClientWorkingMemoryStore",
    "Fact",
    "Thread",
    "WithheldTopic",
    "Stance",
    "STANCES",
    "BackstoryCorpus",
    "build_corpus",
]
