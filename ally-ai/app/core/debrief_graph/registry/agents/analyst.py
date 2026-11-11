"""`analyst`: today's Analyst step as a registry agent, nearly always chosen
(spec Q1). Its evidence map stays the Writer's and the checks' input and is
also summarised into findings."""

from app.core.debrief_graph import model_steps
from app.core.debrief_graph.constants import Step
from app.core.debrief_graph.findings import evidence_findings
from app.core.debrief_graph.registry.agents._common import registry_step
from app.core.debrief_graph.registry.manifest import AgentManifest, register


def _evidence(state, ctx, res):
    evidence = res.get("evidence") or {}
    return {"evidence": evidence, "workspace": {"evidence": evidence}}, None


MANIFEST = register(
    AgentManifest(
        id="analyst",
        version=1,
        kind="subagent",
        description=(
            "Reads the whole transcript and builds the evidence map: each skill's "
            "opportunity, observed / partial / missed with the exact quote, the "
            "pivotal moments and the AI client's faults."
        ),
        use_when="Almost always: the Writer writes from its evidence map.",
        skip_when=(
            "Only when the session is so short there is nothing to map; the "
            "debrief is then written from the transcript alone."
        ),
        progress_label="Reading your session…",
        progress_label_key="debrief.progress.analyst",
        available=lambda p: True,
        reads=("session",),
        privacy_class="session",
        prompt="debrief_analyst_system",
        model="gemini-2.5-pro",
        cost_estimate_usd=0.03,
        latency_estimate_ms=40_000,
        eval_suite_id="debrief-analyst",
        ai_task_id="debrief-analyst",
        writer_has_own_block=True,
        step=registry_step(
            "analyst",
            model_steps.ANALYST,
            Step.ANALYST,
            on_success=_evidence,
            findings=lambda s, c, r: evidence_findings(r.get("evidence") or {}),
        ),
    )
)
