"""
Pruning in-memory checkpointer for LangGraph.

Keeps only the **latest** checkpoint per (thread_id, namespace) so memory
stays O(1) per turn instead of growing quadratically with plain
``MemorySaver``.  Old checkpoint entries, their pending writes, and any
blobs they referenced are pruned immediately after each new checkpoint is
committed.

Used by both the live simulation graph and the report generation graph.
Call ``delete_thread(thread_id)`` once a session finishes (success or
error) to release every byte associated with that run.
"""

from langgraph.checkpoint.memory import MemorySaver

from app.core.logger import get_logger

logger = get_logger(__name__)


class PruningCheckpointer(MemorySaver):
    """
    In-memory checkpointer that retains only the latest checkpoint.

    On each ``put`` the previous checkpoint, its pending writes, and any
    stale blobs are deleted so that memory consumption stays constant
    regardless of how many graph turns are executed.
    """

    def __init__(self) -> None:
        super().__init__()
        self._latest_ids: dict[tuple[str, str], str] = {}

    def put(self, config, checkpoint, metadata, new_versions):
        result = super().put(config, checkpoint, metadata, new_versions)
        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"]["checkpoint_ns"]
        current_id = checkpoint["id"]

        ns_key = (thread_id, checkpoint_ns)
        prev_id = self._latest_ids.get(ns_key)
        self._latest_ids[ns_key] = current_id

        if prev_id is not None:
            ns_storage = self.storage.get(thread_id, {}).get(checkpoint_ns, {})

            if prev_id in ns_storage:
                del ns_storage[prev_id]

            writes_key = (thread_id, checkpoint_ns, prev_id)
            if writes_key in self.writes:
                del self.writes[writes_key]

            current_raw = ns_storage.get(current_id)
            if current_raw:
                current_ckpt = self.serde.loads_typed(current_raw[0])
                active_versions = set(current_ckpt.get("channel_versions", {}).values())
                for blob_key in list(self.blobs.keys()):
                    if (
                        blob_key[0] == thread_id
                        and blob_key[1] == checkpoint_ns
                        and blob_key[3] not in active_versions
                    ):
                        del self.blobs[blob_key]

        return result

    def delete_thread(self, thread_id: str) -> None:
        super().delete_thread(thread_id)

        # Debug: Print _latest_ids deletion info
        matching_keys = [key for key in list(self._latest_ids) if key[0] == thread_id]

        for thread_namespace_key in matching_keys:
            del self._latest_ids[thread_namespace_key]

        logger.info("Checkpointer cleared for thread_id=%s", thread_id)
