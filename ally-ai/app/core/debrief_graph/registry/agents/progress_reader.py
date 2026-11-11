"""`progress_reader`: today's Progress reader as a registry agent: the
learner's earlier Work-on-this points against this session's evidence."""

from app.core.debrief_graph import model_steps
from app.core.debrief_graph.constants import Step
from app.core.debrief_graph.registry.agents._common import registry_step
from app.core.debrief_graph.registry.manifest import AgentManifest, register


def _as_findings(state, ctx, res):
    items = ((res.get("progress") or {}).get("items")) or []
    return [
        {
            "kind": "progress",
            "point": f"{i.get('skill')}: {str(i.get('trend') or '').replace('_', ' ')}"
            + (f". {i['evidence']}" if i.get("evidence") else ""),
            "importance": 2,
            "confidence": "low" if i.get("trend") == "too_early" else "medium",
            "source": "history:past_work_on_this",
        }
        for i in items
    ]


MANIFEST = register(
    AgentManifest(
        id="progress_reader",
        version=1,
        kind="subagent",
        description=(
            "Compares this session's evidence map with the learner's earlier "
            "Work-on-this points and says only what the evidence supports."
        ),
        use_when="The learner has earlier Work-on-this points to follow up.",
        skip_when="No earlier debriefs, or nothing in them this session could answer.",
        progress_label="Looking at your past sessions…",
        progress_label_key="debrief.progress.progress_reader",
        available=lambda p: p["has_learner"] and p["past_work_on_this_points"] > 0,
        requires=("analyst",),
        reads=("session", "learner_history"),
        privacy_class="learner",
        prompt="debrief_progress_reader_system",
        model="gemini-2.5-flash",
        cost_estimate_usd=0.002,
        latency_estimate_ms=10_000,
        eval_suite_id="debrief-progress-reader",
        ai_task_id="debrief-progress-reader",
        writer_has_own_block=True,
        step=registry_step(
            "progress_reader",
            model_steps.PROGRESS_READER,
            Step.PROGRESS_READER,
            findings=_as_findings,
        ),
    )
)
