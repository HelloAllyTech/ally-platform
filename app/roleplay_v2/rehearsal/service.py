"""RehearsalService — offline QA runs of a v2 spec, delivered via webhook.

Clones the ScenarioReportService lifecycle (app/core/scenario_report/
service.py): a concurrency semaphore, an _ACTIVE registry powering the cancel
endpoint, per-profile sequential runs with cancel checks between turns,
progress webhooks after each profile, and a FAILED backstop wrapper so a
crash can never leave ally-be polling a rehearsal that silently died.

Per profile (SKILLED / POOR / ADVERSARIAL): a SimulatedTrainee converses
with the full Actor+Director runtime through RoleplayTurnEngine (Director
AWAITED each turn), then the hybrid judge scores the run.
"""

from __future__ import annotations

import asyncio
from statistics import mean
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings
from app.core.constants import ROLEPLAY_REHEARSAL_WEBHOOK_ENDPOINT
from app.core.logger import get_logger
from app.llms import create_llm_client
from app.roleplay_v2.director.emitters import DirectorEmitter
from app.roleplay_v2.rehearsal.judge import judge_session
from app.roleplay_v2.rehearsal.schemas import (
    ProfileTranscript,
    RehearsalProgress,
    RehearsalRequest,
    RehearsalResults,
    RehearsalStatus,
    RehearsalWebhookPayload,
    TranscriptTurn,
)
from app.roleplay_v2.rehearsal.trainee import SimulatedTrainee
from app.roleplay_v2.session.turn_loop import RoleplayTurnEngine
from app.roleplay_v2.spec.models import ScenarioSpec

logger = get_logger(__name__)

# Lazily-created semaphore bounding concurrent rehearsals (memory/cost).
_rehearsal_semaphore: Optional[asyncio.Semaphore] = None


def _get_rehearsal_semaphore() -> asyncio.Semaphore:
    global _rehearsal_semaphore
    if _rehearsal_semaphore is None:
        _rehearsal_semaphore = asyncio.Semaphore(
            int(getattr(settings, "REHEARSAL_CONCURRENCY_LIMIT", 2))
        )
    return _rehearsal_semaphore


# Registry of in-flight services, keyed by rehearsal_id (cancel endpoint).
# Process-local, same trade-off as the report registry (one worker/container).
_ACTIVE_REHEARSALS: Dict[str, "RehearsalService"] = {}


def request_cancel(rehearsal_id: str) -> bool:
    """Signal a running rehearsal to stop. False when none is in flight."""
    service = _ACTIVE_REHEARSALS.get(rehearsal_id)
    if service is None:
        logger.info(
            "Cancel requested for rehearsal_id=%s but no active service found",
            rehearsal_id,
        )
        return False
    service.request_cancel()
    return True


async def run_rehearsal_with_concurrency_limit(service: "RehearsalService") -> None:
    """Semaphore-gated execution with a FAILED-webhook backstop.

    Mirrors run_report_with_concurrency_limit: any exception escaping
    service.run() (including bugs in its own error handling) still produces a
    FAILED webhook so the studio UI stops polling.
    """
    rehearsal_id = service.request.rehearsal_id
    semaphore = _get_rehearsal_semaphore()
    async with semaphore:
        logger.info("Rehearsal %s started (concurrency slot acquired)", rehearsal_id)
        try:
            await service.run()
        except Exception as e:  # noqa: BLE001 - outer backstop
            logger.exception(
                "Rehearsal %s crashed outside service.run()'s handler: %s",
                rehearsal_id,
                e,
            )
            try:
                await service._send_webhook(
                    RehearsalWebhookPayload(
                        status=RehearsalStatus.FAILED,
                        progress=service.progress,
                        transcripts=service.transcripts,
                        error_message=f"{type(e).__name__}: {e}"[:500],
                    )
                )
            except Exception:  # noqa: BLE001 - last resort: log loudly
                logger.exception(
                    "Failed to send FAILED webhook for rehearsal %s after crash",
                    rehearsal_id,
                )


class RehearsalService:
    """Runs one rehearsal request end to end."""

    def __init__(self, request: RehearsalRequest) -> None:
        self.request = request
        self._cancel_requested = False
        self.transcripts: List[ProfileTranscript] = []
        self.progress = RehearsalProgress(
            completed=0, total=len(request.config.trainee_profiles)
        )

    def request_cancel(self) -> None:
        if self._cancel_requested:
            return
        self._cancel_requested = True
        logger.info(
            "Cancel requested for rehearsal_id=%s — will exit between turns",
            self.request.rehearsal_id,
        )

    # ------------------------------------------------------------------
    # Webhook
    # ------------------------------------------------------------------

    async def _send_webhook(self, payload: RehearsalWebhookPayload) -> None:
        url = (
            f"{settings.CORE_SERVICE_BASE_URL}"
            f"{ROLEPLAY_REHEARSAL_WEBHOOK_ENDPOINT}"
            f"/{self.request.rehearsal_id}"
        )
        logger.info(
            "Sending rehearsal webhook to %s (status=%s, progress=%d/%d)",
            url,
            payload.status,
            payload.progress.completed,
            payload.progress.total,
        )
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.patch(
                    url,
                    json=payload.model_dump(mode="json"),
                    headers={
                        "Content-Type": "application/json",
                        "x-api-key": settings.CORE_SERVICE_API_KEY,
                    },
                )
                resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.error(
                "Rehearsal webhook failed with HTTP %d for rehearsal_id=%s: %s",
                e.response.status_code,
                self.request.rehearsal_id,
                e.response.text,
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "Unexpected error sending rehearsal webhook for rehearsal_id=%s",
                self.request.rehearsal_id,
            )

    # ------------------------------------------------------------------
    # LLM wiring (overridable in tests)
    # ------------------------------------------------------------------

    def _build_actor_llm(self, spec: ScenarioSpec) -> Any:
        config = spec.actor_model.to_llm_config() if spec.actor_model else None
        return create_llm_client(
            llm_config=config, language_code=spec.language_code
        ).llm_instance

    def _build_director_llm(self, spec: ScenarioSpec) -> Any:
        if spec.director_model is not None:
            config = spec.director_model.to_llm_config()
        else:
            config = {
                "provider": getattr(settings, "DIRECTOR_PROVIDER", "openai"),
                "config": {
                    "model": getattr(settings, "DIRECTOR_MODEL", "gpt-4o-mini"),
                    "temperature": 0,
                },
            }
        return create_llm_client(
            llm_config=config, language_code=spec.language_code
        ).llm_instance

    def _build_trainee_llm(self, spec: ScenarioSpec) -> Any:
        return create_llm_client(language_code=spec.language_code).llm_instance

    def _build_judge_llm(self, spec: ScenarioSpec) -> Any:
        model = self.request.config.judge_model or getattr(
            settings, "REHEARSAL_JUDGE_MODEL", "gpt-4o-mini"
        )
        return create_llm_client(
            llm_config={
                "provider": "openai",
                "config": {"model": model, "temperature": 0},
            },
            language_code=spec.language_code,
        ).llm_instance

    # ------------------------------------------------------------------
    # Main execution
    # ------------------------------------------------------------------

    async def run(self) -> None:
        rehearsal_id = self.request.rehearsal_id
        if rehearsal_id in _ACTIVE_REHEARSALS:
            logger.warning(
                "Duplicate rehearsal_id=%s in registry; overwriting", rehearsal_id
            )
        _ACTIVE_REHEARSALS[rehearsal_id] = self
        try:
            spec = ScenarioSpec.model_validate(self.request.spec)
            profiles = list(self.request.config.trainee_profiles)
            turns_per_profile = self.request.config.turns_per_profile or int(
                getattr(settings, "REHEARSAL_TURNS_DEFAULT", 12)
            )
            self.progress = RehearsalProgress(completed=0, total=len(profiles))
            logger.info(
                "Starting rehearsal %s: profiles=%s turns_per_profile=%d",
                rehearsal_id,
                profiles,
                turns_per_profile,
            )

            actor_llm = self._build_actor_llm(spec)
            director_llm = self._build_director_llm(spec)
            trainee_llm = self._build_trainee_llm(spec)
            judge_llm = self._build_judge_llm(spec)

            for index, profile in enumerate(profiles):
                if self._cancel_requested:
                    break
                profile_result = await self._run_profile(
                    spec,
                    profile,
                    turns_per_profile,
                    actor_llm=actor_llm,
                    director_llm=director_llm,
                    trainee_llm=trainee_llm,
                    judge_llm=judge_llm,
                )
                self.transcripts.append(profile_result)
                self.progress = RehearsalProgress(
                    completed=index + 1, total=len(profiles)
                )
                # Contract: an IN_PROGRESS progress PATCH after each profile.
                await self._send_webhook(
                    RehearsalWebhookPayload(
                        status=RehearsalStatus.IN_PROGRESS,
                        progress=self.progress,
                        transcripts=self.transcripts,
                    )
                )

            if self._cancel_requested:
                logger.info(
                    "Rehearsal %s cancelled — shipping CANCELLED with %d "
                    "partial profile transcript(s)",
                    rehearsal_id,
                    len(self.transcripts),
                )
                await self._send_webhook(
                    RehearsalWebhookPayload(
                        status=RehearsalStatus.CANCELLED,
                        progress=self.progress,
                        transcripts=self.transcripts,
                    )
                )
                return

            results = self._aggregate_results()
            report_markdown = self._build_report_markdown(spec, results)
            await self._send_webhook(
                RehearsalWebhookPayload(
                    status=RehearsalStatus.COMPLETED,
                    progress=self.progress,
                    results=results,
                    report_markdown=report_markdown,
                    transcripts=self.transcripts,
                )
            )
            logger.info(
                "Rehearsal %s completed (overall=%d)", rehearsal_id, results.overall
            )

        except Exception as e:  # noqa: BLE001 - FAILED webhook on any error
            logger.exception("Rehearsal %s failed: %s", rehearsal_id, e)
            await self._send_webhook(
                RehearsalWebhookPayload(
                    status=RehearsalStatus.FAILED,
                    progress=self.progress,
                    transcripts=self.transcripts,
                    error_message=f"{type(e).__name__}: {e}"[:500],
                )
            )
        finally:
            _ACTIVE_REHEARSALS.pop(rehearsal_id, None)

    async def _run_profile(
        self,
        spec: ScenarioSpec,
        profile: str,
        turns: int,
        *,
        actor_llm: Any,
        director_llm: Any,
        trainee_llm: Any,
        judge_llm: Any,
    ) -> ProfileTranscript:
        """One full simulated session for a single trainee profile."""
        room_id = f"rehearsal-{self.request.rehearsal_id}-{profile.lower()}"
        emitter = DirectorEmitter(room_id, room=None, enable_sqs=False)
        engine = RoleplayTurnEngine(
            spec,
            actor_llm,
            director_llm,
            room_id=room_id,
            emitter=emitter,
        )
        trainee = SimulatedTrainee(profile, trainee_llm, spec)
        transcript: List[TranscriptTurn] = []

        opening = await engine.opening()
        transcript.append(
            TranscriptTurn(
                role="CLIENT",
                content=opening.actor_text,
                turn_index=0,
                state_id=opening.state_snapshot.current_state_id,
                stage_direction=opening.state_snapshot.stage_direction,
            )
        )
        client_text = opening.actor_text

        for _ in range(turns):
            # Cancel between turns so the button feels responsive.
            if self._cancel_requested:
                break
            trainee_text = await trainee.respond(client_text)
            pre_state = (await engine.state_store.snapshot()).current_state_id
            result = await engine.trainee_turn(trainee_text, await_director=True)
            snapshot = result.state_snapshot
            transcript.append(
                TranscriptTurn(
                    role="TRAINEE",
                    content=trainee_text,
                    turn_index=snapshot.turn_index,
                    state_id=pre_state,
                )
            )
            transcript.append(
                TranscriptTurn(
                    role="CLIENT",
                    content=result.actor_text,
                    turn_index=snapshot.turn_index,
                    state_id=snapshot.current_state_id,
                    stage_direction=snapshot.stage_direction,
                )
            )
            client_text = result.actor_text

        # Close out the run: summary lands in the emitter trace for the judge.
        if engine.director is not None:
            await engine.director.emit_session_summary()
        await engine.close()

        judgement = await judge_session(
            spec, profile, transcript, emitter.trace, judge_llm
        )
        logger.info(
            "Rehearsal %s profile=%s judged: %s",
            self.request.rehearsal_id,
            profile,
            judgement.dimension_scores(),
        )
        return ProfileTranscript(
            trainee_profile=profile,
            transcript=transcript,
            judge_scores=judgement.dimension_scores(),
            judge_notes=judgement.critique_markdown,
            director_trace=list(emitter.trace),
        )

    # ------------------------------------------------------------------
    # Aggregation + report
    # ------------------------------------------------------------------

    def _aggregate_results(self) -> RehearsalResults:
        """Fold per-profile scores into the four headline dimensions.

        persona_consistency / difficulty_calibration: mean across profiles.
        disclosure_discipline: MIN across profiles — one leaking profile is a
        real defect regardless of how the others behaved.
        rubric_coverage: the SKILLED run's (deterministic) score when present,
        else the mean.
        """
        per_profile: Dict[str, Dict[str, int]] = {
            p.trainee_profile: p.judge_scores for p in self.transcripts
        }

        def collect(dimension: str) -> List[int]:
            return [
                scores[dimension]
                for scores in per_profile.values()
                if dimension in scores
            ]

        dimensions: Dict[str, int] = {}
        persona = collect("persona_consistency")
        dimensions["persona_consistency"] = round(mean(persona)) if persona else 0
        discipline = collect("disclosure_discipline")
        dimensions["disclosure_discipline"] = min(discipline) if discipline else 0
        difficulty = collect("difficulty_calibration")
        dimensions["difficulty_calibration"] = (
            round(mean(difficulty)) if difficulty else 0
        )
        skilled = per_profile.get("SKILLED", {})
        if "rubric_coverage" in skilled:
            dimensions["rubric_coverage"] = skilled["rubric_coverage"]
        else:
            coverage = collect("rubric_coverage")
            dimensions["rubric_coverage"] = round(mean(coverage)) if coverage else 0

        overall = round(mean(dimensions.values())) if dimensions else 0
        return RehearsalResults(
            overall=overall, dimensions=dimensions, per_profile=per_profile
        )

    def _build_report_markdown(
        self, spec: ScenarioSpec, results: RehearsalResults
    ) -> str:
        lines = [
            f"# Rehearsal report — {spec.title}",
            "",
            f"**Overall: {results.overall}/100**",
            "",
            "| Dimension | Score |",
            "| --- | --- |",
        ]
        for name, score in results.dimensions.items():
            lines.append(f"| {name.replace('_', ' ').title()} | {score} |")
        for profile in self.transcripts:
            lines.append("")
            lines.append(f"## {profile.trainee_profile} run")
            scores = ", ".join(
                f"{k.replace('_', ' ')}: {v}" for k, v in profile.judge_scores.items()
            )
            lines.append(f"_Scores — {scores}_")
            lines.append("")
            lines.append(profile.judge_notes or "(no judge critique)")
        return "\n".join(lines)
