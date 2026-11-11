"""`assessment_anchoring`: the Assessment recipe's part as a data agent. When
chosen, only findings anchored to a quote checked against the transcript reach
the Writer: every point the debrief makes about a graded attempt rests on a
quoted moment. The Writer's assessment mode itself (never re-grade) stays in
code, by session type, whatever the planner chooses."""

from app.core.debrief_graph.registry.manifest import AgentManifest, register


def apply(state, ctx):
    return {"data_agents": ["assessment_anchoring"], "anchor_quotes": True}


MANIFEST = register(
    AgentManifest(
        id="assessment_anchoring",
        version=1,
        kind="data",
        description=(
            "For a graded attempt: keeps every finding the Writer sees anchored "
            "to a quoted moment of the transcript."
        ),
        use_when="An assessment session.",
        skip_when="Never for an assessment session.",
        progress_label="Reading your session…",
        progress_label_key="debrief.progress.assessment_anchoring",
        available=lambda p: p["assessment"],
        reads=("session",),
        privacy_class="session",
        writer_has_own_block=True,
        apply=apply,
    )
)
