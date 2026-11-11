"""`cohort_comparison` (new, needs `query_aggregates`): this session's skills
against how often other trainees in the organisation show them. Code over an
aggregate, no model. Within NFR-7: a finding only ever makes a hard moment feel
normal or names a less common strength; it never ranks the learner."""

from langgraph.runtime import Runtime

from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.registry.agents._aggregates import (
    run_aggregate,
    session_skills,
)
from app.core.debrief_graph.registry.manifest import AgentManifest, register

AGENT = "cohort_comparison"
QUERY = "cohort_skill_rates"
#: A skill at most this share of trainees show is "uncommon".
UNCOMMON = 1 / 3


def to_findings(rows, skills):
    out = []
    for r in rows:
        skill = str(r.get("skill") or "").strip().lower()
        share = r.get("observed_share")
        if skill not in skills or not isinstance(share, (int, float)):
            continue
        if share > UNCOMMON:
            continue
        if skills[skill] == "observed":
            out.append(
                {
                    "kind": "comparison",
                    "point": (
                        f"{r.get('skill')}: a strength fewer trainees in the "
                        "organisation show."
                    ),
                    "importance": 2,
                    "confidence": "medium",
                    "source": f"aggregate:{QUERY}",
                }
            )
        elif skills[skill] == "missed":
            out.append(
                {
                    "kind": "comparison",
                    "point": (
                        f"{r.get('skill')}: many trainees in the organisation find "
                        "this hard too."
                    ),
                    "importance": 2,
                    "confidence": "medium",
                    "source": f"aggregate:{QUERY}",
                }
            )
    return out


async def run(state, runtime: Runtime[Ctx]):
    skills = sorted(session_skills(state))[:10]
    return await run_aggregate(
        state,
        runtime,
        agent=AGENT,
        query=QUERY,
        params={"skills": skills},
        why="Compares this session's skills with how often peers show them.",
        to_findings=to_findings,
    )


MANIFEST = register(
    AgentManifest(
        id=AGENT,
        version=1,
        kind="tool",
        description=(
            "For this session's skills, how often other trainees in the "
            "organisation show them (groups of five or more): names a less "
            "common strength, or a moment many find hard. Never a rank or a number."
        ),
        use_when=(
            "The learner is clearly ahead of or "
            "behind peers on a skill in this session."
        ),
        skip_when="No cohort data, or nothing in the session stands out against peers.",
        progress_label="Seeing how others found this…",
        progress_label_key="debrief.progress.cohort_comparison",
        available=lambda p: p["cohort_data"],
        requires=("analyst",),
        reads=("aggregates",),
        privacy_class="aggregate",
        tools=("query_aggregates",),
        latency_estimate_ms=2_000,
        status="experimental",
        eval_suite_id="debrief-cohort-comparison",
        run=run,
    )
)
