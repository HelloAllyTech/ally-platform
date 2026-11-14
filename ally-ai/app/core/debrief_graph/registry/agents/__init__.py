"""The human-made registry agents (spec A9), one module each. Importing this
package registers them, in an order that puts every agent after the ones it
requires."""

from app.core.debrief_graph.registry.agents import (  # noqa: F401
    analyst,
    assessment_anchoring,
    case_memory,
    cohort_comparison,
    course_patterns,
    guidance_lookup,
    history_deep,
    language_specialist,
    progress_reader,
    protocol_check,
)
