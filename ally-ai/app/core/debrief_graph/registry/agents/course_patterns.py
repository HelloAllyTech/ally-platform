"""`course_patterns` (new, needs `query_aggregates`): a miss common across the
learner's course, worth framing as "many people find this hard". Code over an
aggregate, no model."""

from langgraph.runtime import Runtime

from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.registry.agents._aggregates import run_aggregate
from app.core.debrief_graph.registry.manifest import AgentManifest, register

AGENT = "course_patterns"
QUERY = "course_missed_skills"
#: Missed by at least this share of the course's learners who had the chance.
COMMON_MISS = 0.5


def to_findings(rows, skills):
    out = []
    for r in rows:
        skill = str(r.get("skill") or "").strip().lower()
        share = r.get("missed_share")
        if skills.get(skill) != "missed" or not isinstance(share, (int, float)):
            continue
        if share >= COMMON_MISS:
            out.append(
                {
                    "kind": "comparison",
                    "point": (
                        f"{r.get('skill')}: one of the skills many people on this "
                        "course find hard."
                    ),
                    "importance": 2,
                    "confidence": "medium",
                    "source": f"aggregate:{QUERY}",
                }
            )
    return out


async def run(state, runtime: Runtime[Ctx]):
    return await run_aggregate(
        state,
        runtime,
        agent=AGENT,
        query=QUERY,
        params={},
        why="Looks for a miss that is common across the course.",
        to_findings=to_findings,
    )


MANIFEST = register(
    AgentManifest(
        id=AGENT,
        version=1,
        kind="tool",
        description=(
            "The skills learners on the same course miss most (groups of five or "
            "more): when this session missed one, the debrief can say many "
            "people find it hard."
        ),
        use_when="A course session with a miss that may be common across the course.",
        skip_when="Not a course session, or the session missed nothing notable.",
        progress_label="Seeing how others found this…",
        progress_label_key="debrief.progress.course_patterns",
        available=lambda p: p["course"],
        requires=("analyst",),
        reads=("aggregates",),
        privacy_class="aggregate",
        tools=("query_aggregates",),
        latency_estimate_ms=2_000,
        status="experimental",
        eval_suite_id="debrief-course-patterns",
        run=run,
    )
)
