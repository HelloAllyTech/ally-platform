"""`guidance_lookup`: today's guidance lookup as a registry agent: Context
Library Debrief Guidance for the session's pivotal moments, searched with the
Analyst's words, never the learner's."""

from langgraph.runtime import Runtime

from app.core.debrief_graph import nodes
from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.findings import agent_findings
from app.core.debrief_graph.registry.manifest import AgentManifest, register


async def run(state, runtime: Runtime[Ctx]):
    update = await nodes.guidance_lookup(state, runtime)
    found = [
        {
            "kind": "context",
            "point": f"Practice guidance that fits a pivotal moment: {p['title']}",
            "importance": 2,
            "confidence": "medium",
            "source": "guidance",
        }
        for p in update.get("passages") or []
    ]
    return {
        **update,
        "findings": {
            "guidance_lookup": agent_findings("guidance_lookup", found, runtime.context)
        },
        "agent_ok": {"guidance_lookup": True},
    }


MANIFEST = register(
    AgentManifest(
        id="guidance_lookup",
        version=1,
        kind="knowledge",
        description=(
            "Looks up practice guidance (the organisation's and Ally's Debrief "
            "Guidance) for up to three pivotal moments; the Writer may use it "
            "where it fits. An organisation's protocols come back labelled."
        ),
        use_when="A moment where practice guidance would help the learner.",
        skip_when=(
            "A short or unremarkable session with no pivotal moment worth "
            "guidance."
        ),
        progress_label="Looking up guidance…",
        progress_label_key="debrief.progress.guidance_lookup",
        available=lambda p: True,
        requires=("analyst",),
        reads=("guidance",),
        privacy_class="session",
        tools=("guidance_search",),
        latency_estimate_ms=4_000,
        eval_suite_id="debrief-guidance",
        writer_has_own_block=True,
        run=run,
    )
)
