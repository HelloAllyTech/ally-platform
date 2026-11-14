"""`history_deep` (new): a pattern across several past debriefs, read through
the gateway tool `get_learner_history`, against this session's evidence map."""

from app.core.debrief.steps import DEFAULT_HISTORY_DEEP_SYSTEM
from app.core.debrief_graph.narration import n
from app.core.debrief_graph.registry.agents._common import prompt_agent, tool
from app.core.debrief_graph.registry.manifest import AgentManifest, register
from app.core.llm_usage.tasks import LLMTask

AGENT = "history_deep"
PROMPT = "debrief_history_deep_system"
#: One session is never a trend; three are the least a pattern rests on.
MIN_PAST_SESSIONS = 3


async def fetch(state, ctx):
    found = await tool(ctx, AGENT, "get_learner_history", {"limit": 8})
    sessions = found.get("sessions") or []
    return {"sessions": sessions} if len(sessions) >= MIN_PAST_SESSIONS else None


def blocks(state, ctx):
    return {
        "past_debriefs": (
            "learner_history",
            (state.get("fetched") or {}).get("sessions"),
        ),
        "latest_evidence_map": ("session", state.get("evidence") or {}),
    }


def inputs(state, ctx):
    sessions = (state.get("fetched") or {}).get("sessions") or []
    return [
        "the evidence map",
        n(len(sessions), "past debrief") if sessions else "the learner's past debriefs",
    ]


MANIFEST = register(
    AgentManifest(
        id=AGENT,
        version=1,
        kind="subagent",
        description=(
            "Reads the learner's last debriefs (Work-on-this points, strengths, "
            "skill words) with this session's evidence and names a pattern worth "
            "their attention, only when three or more sessions support it."
        ),
        use_when=(
            "Several past sessions and a skill "
            "that keeps coming up or keeps improving."
        ),
        skip_when=(
            "Fewer than three past debriefs, or "
            "the Progress reader already covers it."
        ),
        progress_label="Looking at your past sessions…",
        progress_label_key="debrief.progress.history_deep",
        available=lambda p: p["has_learner"]
        and p["past_debriefs"] >= MIN_PAST_SESSIONS,
        requires=("analyst",),
        reads=("session", "learner_history"),
        privacy_class="learner",
        prompt=PROMPT,
        model="gemini-2.5-flash",
        backup_model="gemini-3-flash-preview",
        tools=("get_learner_history",),
        cost_estimate_usd=0.004,
        latency_estimate_ms=15_000,
        status="experimental",
        eval_suite_id="debrief-history-deep",
        ai_task_id="debrief-history-deep",
        step=prompt_agent(
            AGENT,
            task=LLMTask.DEBRIEF_HISTORY_DEEP.value,
            default_system=DEFAULT_HISTORY_DEEP_SYSTEM,
            prompt_code=PROMPT,
            why="Looks for a pattern across the learner's past debriefs.",
            inputs=inputs,
            blocks=blocks,
            send_transcript=False,
            fetch=fetch,
        ),
    )
)
