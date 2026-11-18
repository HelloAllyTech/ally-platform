"""`language_specialist` (new): code-mixed and Indic sessions, and quotes in a
script other than the debrief's: what a Writer in the session language could
get wrong."""

from app.core.debrief.steps import DEFAULT_LANGUAGE_SPECIALIST_SYSTEM
from app.core.debrief_graph.registry.agents._common import prompt_agent
from app.core.debrief_graph.registry.manifest import AgentManifest, register
from app.core.debrief_graph.registry.profile import language_facts
from app.core.llm_usage.tasks import LLMTask

AGENT = "language_specialist"
PROMPT = "debrief_language_specialist_system"


def blocks(state, ctx):
    return {"language_profile": ("session", language_facts(ctx))}


MANIFEST = register(
    AgentManifest(
        id=AGENT,
        version=1,
        kind="subagent",
        description=(
            "Reads a code-mixed or Indian-language session for what a Writer "
            "could get wrong: meaning or warmth that depends on the language, "
            "deliberate code-mixing, quotes that must stay in their script."
        ),
        use_when=(
            "Code-mixed or Indic session, or the learner wrote in a different "
            "script from the debrief language."
        ),
        skip_when="A single-language, single-script session.",
        progress_label="Reading the language of your session…",
        progress_label_key="debrief.progress.language_specialist",
        available=lambda p: p["code_mixed"] or p["indic"] or p["script_mismatch"],
        reads=("session",),
        privacy_class="session",
        prompt=PROMPT,
        model="gemini-2.5-flash",
        backup_model="gemini-3-flash-preview",
        cost_estimate_usd=0.004,
        latency_estimate_ms=15_000,
        status="experimental",
        eval_suite_id="debrief-language-specialist",
        ai_task_id="debrief-language-specialist",
        step=prompt_agent(
            AGENT,
            task=LLMTask.DEBRIEF_LANGUAGE_SPECIALIST.value,
            default_system=DEFAULT_LANGUAGE_SPECIALIST_SYSTEM,
            prompt_code=PROMPT,
            why="Reads the session's languages and scripts for the Writer.",
            inputs=lambda s, c: [c.turns_line, "the session's languages and scripts"],
            blocks=blocks,
        ),
    )
)
