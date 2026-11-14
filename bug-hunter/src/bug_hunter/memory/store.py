"""Long-term memory over a LangGraph ``BaseStore`` (spec §8, chunk 07).

Namespaces are ``(scope, app, kind)``: ``scope`` is ``live`` for real runs and a
throwaway ``eval-…`` scope for evals, so an eval never reads or writes live memory.
Every write passes through the PHI scrubber. Search works in two modes:

- semantic (pgvector + the ``embeddings`` role): the store ranks by the query text;
- signature (no pgvector): candidates are read and ranked in code by signature match,
  file overlap and word overlap.

Both modes rerank in code, so tests on ``InMemoryStore`` exercise the same ranking.
"""

from __future__ import annotations

import re
from contextlib import contextmanager
from typing import Any, Iterator

from langgraph.store.base import BaseStore

from bug_hunter.config import BugHunterConfig
from bug_hunter.memory.records import KINDS, MODELS, Record, kind_of, now
from bug_hunter.safety.phi import scrub

LIVE = "live"
MAX_RECALL = 5  # records per recall query, whatever the caller asks for
MIN_WORD_OVERLAP = 0.1  # 2026-11-14 check: related 0.19-0.64, unrelated <= 0.05
# fields that are identifiers, paths, hashes or enums: never scrubbed (a scrubbed
# path would not match the code it points at)
NOT_TEXT = {
    "id",
    "app",
    "files",
    "signature",
    "source_run",
    "created_at",
    "last_used_at",
    "status",
    "fingerprints",
    "diagnosis",
    "fix_verdict",
    "finding",  # scrubbed field by field in scrub_record
    "key",
    "sources",
}
_WORD = re.compile(r"[a-z0-9_]{3,}")


def words(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


def overlap(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def scrub_record(record: Record) -> Record:
    data = record.model_dump()
    if isinstance(data.get("finding"), dict):
        data["finding"] = {
            k: (
                scrub(v)
                if isinstance(v, str) and k not in ("suspected_files", "app")
                else v
            )
            for k, v in data["finding"].items()
        }
        if isinstance(data["finding"].get("evidence"), list):
            data["finding"]["evidence"] = [
                scrub(e) for e in data["finding"]["evidence"]
            ]
    for name, value in data.items():
        if name in NOT_TEXT:
            continue
        if isinstance(value, str):
            data[name] = scrub(value)
        elif isinstance(value, list) and all(isinstance(v, str) for v in value):
            data[name] = [scrub(v) for v in value]
    return type(record).model_validate(data)


class Memory:
    def __init__(
        self,
        store: BaseStore,
        scope: str = LIVE,
        semantic: bool = False,
        scan_limit: int = 500,
        recall_limit: int = 5,
        min_word_overlap: float = MIN_WORD_OVERLAP,
    ):
        self.store = store
        self.scope = scope
        self.semantic = semantic
        self.scan_limit = scan_limit
        self.recall_limit = recall_limit
        self.min_word_overlap = min_word_overlap

    # --- namespaces -------------------------------------------------------------

    def ns(self, app: str, kind: str) -> tuple[str, str, str]:
        if kind not in KINDS:
            raise ValueError(f"unknown memory kind {kind!r}")
        return (self.scope, app, kind)

    def _apps(self) -> list[str]:
        return sorted(
            {
                n[1]
                for n in self.store.list_namespaces(prefix=(self.scope,))
                if len(n) > 2
            }
        )

    # --- write ------------------------------------------------------------------

    def put(self, kind: str, record: Record) -> Record:
        """Scrub, validate against the namespace's model and store."""
        model = MODELS[kind]
        if not isinstance(record, model):
            raise TypeError(f"{kind} needs a {model.__name__}, got {type(record)}")
        clean = scrub_record(record)
        self.store.put(
            self.ns(clean.app, kind),
            clean.id,
            clean.model_dump(),
            index=["text"] if self.semantic else False,
        )
        return clean

    def delete(self, record_id: str) -> bool:
        found = self.get(record_id)
        if found is None:
            return False
        kind, record = found
        self.store.delete(self.ns(record.app, kind), record_id)
        return True

    def touch(self, kind: str, record: Record) -> None:
        record.last_used_at = now()
        self.store.put(
            self.ns(record.app, kind),
            record.id,
            record.model_dump(),
            index=False,  # usage stamps never re-embed
        )

    # --- read -------------------------------------------------------------------

    def get(self, record_id: str) -> tuple[str, Record] | None:
        kind = kind_of(record_id)
        for app in self._apps():
            item = self.store.get(self.ns(app, kind), record_id)
            if item is not None:
                return kind, MODELS[kind].model_validate(item.value)
        return None

    def list(
        self, kind: str | None = None, app: str | None = None, status: str | None = None
    ) -> list[tuple[str, Record]]:
        out: list[tuple[str, Record]] = []
        for a in [app] if app else self._apps():
            for k in [kind] if kind else KINDS:
                for item in self.store.search(self.ns(a, k), limit=self.scan_limit):
                    record = MODELS[k].model_validate(item.value)
                    if status and getattr(record, "status", None) != status:
                        continue
                    out.append((k, record))
        out.sort(key=lambda kr: kr[1].created_at)
        return out

    def search(
        self,
        app: str,
        kind: str,
        query: str = "",
        files: list[str] | None = None,
        signature: str = "",
        limit: int | None = None,
        touch: bool = True,
        where: dict[str, Any] | None = None,
    ) -> list[Any]:
        """Best matches in ``(scope, app, kind)``; empty when nothing is related."""
        items = self.store.search(
            self.ns(app, kind),
            query=query if (self.semantic and query) else None,
            filter=where,
            limit=self.scan_limit,
        )
        q_words = words(query)
        q_files = set(files or [])
        scored: list[tuple[float, Record]] = []
        for item in items:
            record = MODELS[kind].model_validate(item.value)
            same_signature = bool(signature) and record.signature == signature
            shared = len(q_files & set(record.files)) if q_files and record.files else 0
            word_overlap = overlap(q_words, words(record.text))
            # evidence decides whether a record is recalled; similarity only ranks
            if not (same_signature or shared or word_overlap >= self.min_word_overlap):
                continue
            score = 3.0 * same_signature + 2.0 * shared / max(1, len(q_files))
            score += word_overlap
            if self.semantic and item.score is not None:
                score += float(item.score)
            scored.append((score, record))
        scored.sort(key=lambda sr: sr[0], reverse=True)
        cap = min(limit or self.recall_limit, MAX_RECALL)
        found = [r for _, r in scored[:cap]]
        if touch:
            for r in found:
                self.touch(kind, r)
        return found


# --- construction -------------------------------------------------------------------


def in_memory(scope: str = LIVE, **kw: Any) -> Memory:
    from langgraph.store.memory import InMemoryStore

    return Memory(InMemoryStore(), scope=scope, **kw)


def _has_pgvector(conn: Any) -> bool:
    try:
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        return True
    except Exception:  # noqa: BLE001 - extension not installable on this server
        return False


@contextmanager
def open_memory(
    config: BugHunterConfig, url: str | None = None, scope: str = LIVE
) -> Iterator[Memory]:
    """``PostgresStore`` in the bughunter database (``memory.semantic`` decides the
    index); the store's tables are created on first use."""
    from langgraph.store.postgres import PostgresStore
    from psycopg import Connection
    from psycopg.rows import dict_row

    from bug_hunter.graph.checkpointer import db_url

    cfg = config.limits.memory
    conn = Connection.connect(
        url or db_url(), autocommit=True, prepare_threshold=0, row_factory=dict_row
    )
    try:
        semantic = False
        if cfg.semantic != "off":
            semantic = _has_pgvector(conn)
            if cfg.semantic == "on" and not semantic:
                raise RuntimeError(
                    "memory.semantic is 'on' but pgvector is not available on the "
                    "bughunter database"
                )
        index = None
        if semantic:
            from bug_hunter.models import get_embeddings

            index = {"dims": 1536, "embed": get_embeddings(config), "fields": ["text"]}
        store = PostgresStore(conn, index=index)
        store.setup()
        yield Memory(
            store,
            scope=scope,
            semantic=semantic,
            scan_limit=cfg.scan_limit,
            recall_limit=cfg.recall_limit,
            min_word_overlap=cfg.min_word_overlap,
        )
    finally:
        conn.close()
