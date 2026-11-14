"""Normalise and scrub the signal, stamp the clock, open the scratchpad."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.state import BugState
from bug_hunter.safety.phi import scrub, scrub_code


def make_intake_node(deps: GraphDeps):
    def intake(state: BugState) -> dict[str, Any]:
        # a commit sweep's summary is code (diff): pattern scrub only; reports are data
        scrubber = scrub_code if state.signal.source == "commit_sweep" else scrub
        signal = state.signal.model_copy(
            update={"raw_summary": scrubber(state.signal.raw_summary)}
        )
        artefacts = dict(state.artefacts)
        artefacts["scratchpad"] = str(deps.scratchpad.path)
        if deps.mode == "sweep" and deps.diff:
            path = deps.write_artefact("signal-diff.patch", scrub_code(deps.diff))
            artefacts["signal_diff"] = str(path)
        deps.scratchpad.append_note(
            f"intake: {signal.source} {signal.ref} for {deps.app} ({deps.mode} mode)"
        )
        return {
            "signal": signal,
            "app": state.app or deps.app,
            "mode": deps.mode,
            "ref": state.ref or deps.ref,
            "started_at": state.started_at
            or datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "scratchpad_path": str(deps.scratchpad.path),
            "artefacts": artefacts,
            "status": "new",
        }

    return intake
