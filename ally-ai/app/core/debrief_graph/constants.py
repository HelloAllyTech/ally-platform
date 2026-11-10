"""Names, rungs and the run view's fixed sentences, as ally-be's runner had them.

Every English string here is copied from ally-be's `DebriefRunnerService` and
read by the Debrief Console unchanged: change one only on both sides.
"""

from __future__ import annotations

from enum import IntEnum
from typing import Dict


class Step:
    """`DebriefStep` values (ally-be `debrief-release.constants.ts`)."""

    SAFETY_READER = "safety_reader"
    ANALYST = "analyst"
    PROGRESS_READER = "progress_reader"
    GUIDANCE_LOOKUP = "guidance_lookup"
    WRITER = "writer"
    CHECKS = "checks"
    EVALUATOR = "evaluator"
    REVISER = "reviser"


class Recipe:
    STANDARD = "standard"
    SHORT = "short"
    CASE = "case"
    ASSESSMENT = "assessment"


class Status:
    PUBLISHED = "published"
    BELOW_BAR = "below_bar"
    NEEDS_PERSON = "needs_person"
    SKIPPED = "skipped"
    FAILED = "failed"


PROMPT_CODES = {
    "safety_reader": "debrief_safety_reader_system",
    "analyst": "debrief_analyst_system",
    "progress_reader": "debrief_progress_reader_system",
    "writer": "debrief_writer_system",
    "reviser": "debrief_reviser_system",
    "rubric": "debrief_quality_rubric",
}


class FallbackRung(IntEnum):
    """The fallback ladder (plan §10.3); a run records the deepest rung reached."""

    NONE = 0
    SKIP_SECOND_REVISION = 1
    SKIP_PROGRESS = 2
    ONE_GUIDANCE_LOOKUP = 3
    SKIP_FIRST_REVISION = 4
    WRITER_AND_CHECKS_ONLY = 5
    PERSON_FINISHES = 6


#: Seconds one attempt at a step may take before it is retried (on the backup
#: model when there is one): ally-be's `STEP_TIMEOUT_MS`, now the node timeout.
STEP_TIMEOUT_S: Dict[str, float] = {
    "safety-reader": 60.0,
    "progress-reader": 50.0,
    "analyst": 90.0,
    "writer": 75.0,
    "evaluator": 90.0,
    "reviser": 120.0,
}

#: Shown in place of a failed check list when `run_checks` names no advisory codes.
DEFAULT_ADVISORY_CHECKS = frozenset({"total_too_long"})

#: The runner's reason for a skipped step, by the note it records.
SKIP_WHY: Dict[str, str] = {
    "budget": "Skipped: not enough of the run budget was left for it.",
    "deadline": "Skipped: too little time was left before the deadline.",
    "no history": "Skipped: this learner has no earlier debriefs to follow up.",
}

#: Why a run ended before a draft was judged, by its skip reason.
END_WHY: Dict[str, str] = {
    "no_session": "Stopped: the session could not be found.",
    "too_short": "No debrief: the learner said nothing in the session.",
    "no_transcript": "No debrief: the session has no transcript.",
    "monthly_cap": (
        "Held for a person: this month’s debrief budget is spent, so no run "
        "could start."
    ),
    "budget_below_minimum": (
        "Held for a person: the run budget could not cover the minimum steps."
    ),
    "safety_reader_failed": (
        "Held for a person: the safety reading failed, and nothing is published "
        "without one."
    ),
    "writer_failed": "Held for a person: the Writer failed on both of its models.",
}

FAILED_WHY = "Failed: an unexpected error stopped the run (see the error)."

#: Dimension → weight (ally-be `DEBRIEF_QUALITY_DIMENSIONS`).
QUALITY_WEIGHTS: Dict[str, float] = {
    "evidence_specificity": 0.2,
    "accuracy": 0.2,
    "actionability": 0.15,
    "prioritisation": 0.1,
    "personalisation_progress": 0.1,
    "practice_alignment": 0.1,
    "tone": 0.1,
    "clarity": 0.05,
}
HARD_FAIL_CAP = 4
