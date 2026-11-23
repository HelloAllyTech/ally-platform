"""`protocol_check` (new): the session against the organisation's own
protocols, read through the gateway tool `get_org_protocols`."""

from app.core.debrief.steps import DEFAULT_PROTOCOL_CHECK_SYSTEM
from app.core.debrief_graph.narration import n
from app.core.debrief_graph.registry.agents._common import prompt_agent, tool
from app.core.debrief_graph.registry.manifest import AgentManifest, register
from app.core.llm_usage.tasks import LLMTask

AGENT = "protocol_check"
PROMPT = "debrief_protocol_check_system"


async def fetch(state, ctx):
    found = await tool(ctx, AGENT, "get_org_protocols", {})
    protocols = found.get("protocols") or []
    if not protocols and not found.get("procedures"):
        return None
    return {"protocols": protocols, "procedures": found.get("procedures")}


def blocks(state, ctx):
    fetched = state.get("fetched") or {}
    safety = state.get("safety") or {}
    return {
        "organisation_protocols": ("org_protocols", fetched.get("protocols")),
        "organisation_procedures": ("org_protocols", fetched.get("procedures")),
        "safety_reading": ("session", {"risk_cues": safety.get("risk_cues") or []}),
    }


def inputs(state, ctx):
    return [
        ctx.turns_line,
        "the organisation's protocols",
        n(len((state.get("safety") or {}).get("risk_cues") or []), "risk cue"),
    ]


MANIFEST = register(
    AgentManifest(
        id=AGENT,
        version=1,
        kind="subagent",
        description=(
            "Checks the session against the learner's organisation's own "
            "protocols (referral, escalation, what to say about risk): which the "
            "session touched, and whether the learner followed them."
        ),
        use_when=(
            "The organisation has protocols and the session touches a topic they "
            "cover, or there is a risk cue."
        ),
        skip_when=(
            "The organisation has no protocols, or "
            "nothing in the session falls under one."
        ),
        progress_label="Checking your organisation's guidance…",
        progress_label_key="debrief.progress.protocol_check",
        available=lambda p: p["org_protocols"] > 0,
        reads=("session", "org_protocols"),
        privacy_class="session",
        prompt=PROMPT,
        model="gemini-2.5-flash",
        backup_model="gemini-3-flash-preview",
        tools=("get_org_protocols",),
        cost_estimate_usd=0.004,
        latency_estimate_ms=15_000,
        status="experimental",
        eval_suite_id="debrief-protocol-check",
        ai_task_id="debrief-protocol-check",
        step=prompt_agent(
            AGENT,
            task=LLMTask.DEBRIEF_PROTOCOL_CHECK.value,
            default_system=DEFAULT_PROTOCOL_CHECK_SYSTEM,
            prompt_code=PROMPT,
            why="Checks the session against the organisation's own protocols.",
            inputs=inputs,
            blocks=blocks,
            fetch=fetch,
        ),
    )
)
