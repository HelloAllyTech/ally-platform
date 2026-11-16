"""The debrief's model steps, called in-process by the graph's nodes.

Each maps a step body onto `steps.py` / `safety_reader.py` and answers in the
wire shape the former per-step endpoints used (the step records and ally-be
read it): the same dicts, the same `model` and `reasoning`, and the same
failures (a step with no usable answer is a 502, one that raised is a 500).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Protocol

from pydantic import TypeAdapter

from app.core.config import settings
from app.core.debrief import steps
from app.core.debrief.safety_reader import (
    LearnerDistress,
    RiskCue,
    TranscriptTurn,
    read_safety,
)
from app.core.debrief.schemas import (
    AgentFindings,
    DebriefCards,
    EvaluationOutput,
    EvidenceMap,
    PlannerOutput,
    ProgressReading,
    ProgressReport,
    reasoning_of,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)


class StepError(Exception):
    """A step attempt that failed, as ally-be's `DebriefStepError` saw it."""

    def __init__(self, status: Optional[int], message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class StepRunner(Protocol):
    async def run(
        self,
        path: str,
        body: Dict[str, Any],
        model: Optional[str],
        session_id: Optional[str],
    ) -> Dict[str, Any]: ...


def _dump(schema: Any, value: Any) -> Any:
    # The endpoints' response models declare the parent type, so pydantic
    # serialises only its fields: the `reasoning` a *Reasoned subclass carries
    # never reaches the evidence map or the cards.
    return TypeAdapter(schema).dump_python(value, mode="json")


def _turns(raw: List[Dict[str, Any]]) -> List[TranscriptTurn]:
    return [TranscriptTurn.model_validate(t) for t in raw or []]


class InProcessSteps:
    """The production StepRunner."""

    async def run(
        self,
        path: str,
        body: Dict[str, Any],
        model: Optional[str],
        session_id: Optional[str],
    ) -> Dict[str, Any]:
        handler = getattr(self, "_" + path.replace("-", "_"), None)
        if handler is None and path.startswith("agent-"):
            # A prompt-only registry agent (`agent-<id>`): one generic call.
            handler = self._findings
        label = "safety reader" if path == "safety-reader" else path
        try:
            answer = await handler(body, model, session_id)
        except StepError:
            raise
        except Exception as exc:  # noqa: BLE001 - the endpoint's 500
            logger.exception("[debrief-%s] failed", path)
            raise StepError(500, f"{label} failed") from exc
        if answer is None:
            raise StepError(502, f"{label} returned no usable answer")
        return answer

    async def _safety_reader(self, body, model, session_id):
        reading, ran = await read_safety(
            _turns(body.get("transcript")),
            body.get("language") or "en",
            system=body.get("system_prompt"),
            scenario_session_id=session_id,
            model=model,
        )
        if reading is None:
            return None
        return {
            "model": ran,
            "risk_cues": _dump(List[RiskCue], reading.risk_cues),
            "learner_distress": _dump(List[LearnerDistress], reading.learner_distress),
        }

    async def _analyst(self, body, model, session_id):
        out, ran = await steps.analyse(
            _turns(body.get("transcript")),
            body.get("language") or "en",
            model or settings.DEBRIEF.ANALYST_MODEL,
            scenario=body.get("scenario") or {},
            expected_behaviours=body.get("expected_behaviours") or [],
            learner_level=body.get("learner_level"),
            system=body.get("system_prompt"),
            scenario_session_id=session_id,
            live_detections=body.get("live_detections") or [],
            case_memory=body.get("case_memory"),
        )
        if out is None:
            return None
        return {
            "model": ran,
            "evidence": _dump(EvidenceMap, out),
            "reasoning": reasoning_of(out),
        }

    async def _progress_reader(self, body, model, session_id):
        out, ran = await steps.read_progress(
            body["evidence"],
            body.get("past_points") or [],
            model or settings.DEBRIEF.PROGRESS_READER_MODEL,
            system=body.get("system_prompt"),
            scenario_session_id=session_id,
        )
        if out is None:
            return None
        return {
            "model": ran,
            "progress": _dump(ProgressReading, out),
            "reasoning": reasoning_of(out),
        }

    async def _progress_agent(self, body, model, session_id):
        out, ran = await steps.read_progress_report(
            body.get("evidence") or {},
            body.get("profile") or {},
            body.get("this_session") or {},
            body.get("language") or "en",
            model or settings.DEBRIEF.PROGRESS_AGENT_MODEL,
            system=body.get("system_prompt"),
            scenario_session_id=session_id,
        )
        if out is None:
            return None
        return {
            "model": ran,
            "report": _dump(ProgressReport, out),
            "reasoning": reasoning_of(out),
        }

    async def _writer(self, body, model, session_id):
        out, ran = await steps.write(
            body["evidence"],
            body.get("safety") or {},
            body.get("language") or "en",
            model or settings.DEBRIEF.WRITER_MODEL,
            _turns(body.get("transcript")),
            passages=body.get("passages") or [],
            progress=body.get("progress"),
            learner_level=body.get("learner_level"),
            tone=body.get("tone"),
            short=bool(body.get("short")),
            system=body.get("system_prompt"),
            scenario_session_id=session_id,
            practice_options=body.get("practice_options") or [],
            case_memory=body.get("case_memory"),
            assessment=bool(body.get("assessment")),
            cohort=body.get("cohort"),
            findings=body.get("findings"),
        )
        if out is None:
            return None
        return {
            "model": ran,
            "cards": _dump(DebriefCards, out),
            "reasoning": reasoning_of(out),
        }

    async def _evaluator(self, body, model, session_id):
        out, ran = await steps.evaluate(
            _turns(body.get("transcript")),
            body["debrief"],
            body.get("language") or "en",
            model or settings.DEBRIEF.EVALUATOR_MODEL,
            rubric=body.get("rubric"),
            learner_level=body.get("learner_level"),
            guidance=body.get("guidance"),
            scenario_session_id=session_id,
            history=body.get("history"),
        )
        if out is None:
            return None
        return {
            "model": ran,
            "evaluation": _dump(EvaluationOutput, out),
            "reasoning": reasoning_of(out),
        }

    async def _reviser(self, body, model, session_id):
        out, ran = await steps.revise(
            body["draft"],
            body.get("critique") or [],
            body.get("evidence") or {},
            _turns(body.get("excerpts")),
            body.get("language") or "en",
            model or settings.DEBRIEF.REVISER_MODEL,
            system=body.get("system_prompt"),
            scenario_session_id=session_id,
            findings=body.get("findings"),
        )
        if out is None:
            return None
        return {
            "model": ran,
            "cards": _dump(DebriefCards, out),
            "reasoning": reasoning_of(out),
        }

    # --- the orchestrator (spec A5, A9) ---------------------------------------

    async def _planner(self, body, model, session_id):
        out, ran = await steps.plan_agents(
            body.get("profile") or {},
            body.get("agents") or [],
            model,
            max_agents=int(body.get("max_agents") or 0),
            system=body.get("system_prompt"),
            critique=body.get("critique"),
            already=body.get("already"),
            evidence_summary=body.get("evidence_summary"),
            scenario_session_id=session_id,
        )
        if out is None:
            return None
        return {
            "model": ran,
            "plan": _dump(PlannerOutput, out),
            "reasoning": reasoning_of(out),
        }

    async def _findings(self, body, model, session_id):
        """A prompt-only registry agent: `body` is what its scopes allow."""
        transcript = body.get("transcript")
        out, ran = await steps.find(
            body["task"],
            body["default_system"],
            body.get("blocks") or {},
            _turns(transcript) if transcript is not None else None,
            body.get("language") or "en",
            model,
            system=body.get("system_prompt"),
            focus_turns=body.get("focus_turns") or [],
            scenario_session_id=session_id,
        )
        if out is None:
            return None
        return {
            "model": ran,
            "findings": _dump(AgentFindings, out)["findings"],
            "reasoning": reasoning_of(out),
        }
