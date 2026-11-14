"""learn: write the run's outcome to long-term memory (spec §5, §8). No model.

Every run with a finding leaves a ``(app, "bugs")`` record (signature, root cause, fix
summary, files, final status, fingerprints of the evidence lines). Human verdicts
update it later through ``bug-hunter feedback``. No memory this run -> no-op.
"""

from __future__ import annotations

from typing import Any

from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.state import BugState


def make_learn_node(deps: GraphDeps):
    def learn(state: BugState) -> dict[str, Any]:
        if deps.memory is None or state.finding is None:
            return {}
        from bug_hunter.memory.feedback import RunSnapshot, bug_record_for

        snapshot = RunSnapshot.from_state(state.model_dump(), deps.app_prefix)
        record = bug_record_for(snapshot, deps.read_at_ref)
        if record is None:
            return {}
        try:
            deps.memory.put("bugs", record)
            deps.scratchpad.append_note(f"learn: wrote {record.id}")
        except Exception as exc:  # noqa: BLE001 - memory must never fail a run
            deps.scratchpad.append_note(f"learn: memory write failed: {exc}"[:300])
        return {}

    return learn
