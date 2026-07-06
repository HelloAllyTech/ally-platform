"""Rehearsal harness: simulated trainees, hybrid judge, webhook service."""

from app.roleplay_v2.rehearsal.judge import (
    RehearsalSessionJudgement,
    SecretLeak,
    compute_rubric_coverage,
    detect_secret_leaks,
    judge_session,
)
from app.roleplay_v2.rehearsal.schemas import (
    RehearsalConfig,
    RehearsalRequest,
    RehearsalResponse,
    RehearsalStatus,
    RehearsalWebhookPayload,
)
from app.roleplay_v2.rehearsal.service import (
    RehearsalService,
    request_cancel,
    run_rehearsal_with_concurrency_limit,
)
from app.roleplay_v2.rehearsal.trainee import SimulatedTrainee

__all__ = [
    "RehearsalConfig",
    "RehearsalRequest",
    "RehearsalResponse",
    "RehearsalService",
    "RehearsalSessionJudgement",
    "RehearsalStatus",
    "RehearsalWebhookPayload",
    "SecretLeak",
    "SimulatedTrainee",
    "compute_rubric_coverage",
    "detect_secret_leaks",
    "judge_session",
    "request_cancel",
    "run_rehearsal_with_concurrency_limit",
]
