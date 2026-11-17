"""`guidance_agent`: the guidance toolbox as a registry agent, so on the
orchestrated path the planner may include or skip it per session. The planner
has no tools itself; it only chooses whether this agent runs. It reads the
guidance index and decides, with its own bounded tool loop, what the Writer
should read (guidance_toolbox.py)."""

from langgraph.runtime import Runtime

from app.core.debrief_graph import guidance_toolbox as toolbox
from app.core.debrief_graph.constants import Step
from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.findings import agent_findings
from app.core.debrief_graph.registry.manifest import AgentManifest, register


def offered(ctx: Ctx) -> bool:
    """Only with a call cap, a tool enabled for this step and a release model."""
    return (
        toolbox.phase_wanted(ctx, Step.GUIDANCE_AGENT)
        and toolbox.agent_model(ctx) is not None
    )


async def run(state, runtime: Runtime[Ctx]):
    """A selection marker only: no gateway call, no model, and only keys no other
    agent in the wave writes. The planner's agents run in one superstep, and
    the guidance agent needs the guidance lookup's passages, so the real work is
    the fixed `guidance_agent` node after dispatch, which runs when this marker
    says the planner chose it."""
    ctx = runtime.context
    return {
        "guidance_agent_selected": True,
        "agent_ok": {"guidance_agent": True},
        "findings": {
            "guidance_agent": agent_findings(
                "guidance_agent",
                [
                    {
                        "kind": "context",
                        "point": "The guidance agent will choose practice guidance.",
                        "importance": 1,
                        "confidence": "medium",
                        "source": "guidance",
                    }
                ],
                ctx,
            )
        },
    }


MANIFEST = register(
    AgentManifest(
        id="guidance_agent",
        version=1,
        kind="knowledge",
        description=(
            "Reads the index of practice guidance (the organisation's protocols, "
            "level guides and style guides) and decides, within a call limit, "
            "which entries the Writer should read for this session's moments."
        ),
        use_when=(
            "A moment, the organisation's protocols or the learner's level "
            "guide could change how the learner is coached."
        ),
        skip_when=(
            "A short session with nothing worth guidance. Never skip when a "
            "risk cue or an organisation protocol applies."
        ),
        progress_label="Choosing guidance…",
        progress_label_key="debrief.progress.guidance_agent",
        available=lambda p: True,
        requires=("analyst",),
        reads=("guidance",),
        privacy_class="session",
        tools=("guidance_index", "guidance_search", "guidance_fetch"),
        latency_estimate_ms=8_000,
        eval_suite_id="debrief-guidance",
        writer_has_own_block=True,
        offered_when=offered,
        run=run,
    )
)
