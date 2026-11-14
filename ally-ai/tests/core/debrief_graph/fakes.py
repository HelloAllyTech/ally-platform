"""Fakes for the Debrief graph tests: the model steps and ally-be's gateway.

No model and no network: `FakeSteps` answers each step in its wire shape (or
fails it), `FakeGateway` plays ally-be's tools. Both record every call.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Dict, List, Optional

from langgraph.checkpoint.memory import InMemorySaver

from app.core.debrief_graph.context import DebriefRunContext
from app.core.debrief_graph.gateway import GatewayError
from app.core.debrief_graph.graph import build_graph
from app.core.debrief_graph.runner import run_debrief
from app.core.debrief_graph.step_functions import StepError

DIMENSIONS = [
    "evidence_specificity",
    "accuracy",
    "actionability",
    "prioritisation",
    "personalisation_progress",
    "practice_alignment",
    "tone",
    "clarity",
]

TRANSCRIPT = [
    {"turn_index": 1, "role": "counselor", "text": "What brings you in today?"},
    {"turn_index": 2, "role": "client", "text": "I don't see the point anymore."},
    {"turn_index": 3, "role": "counselor", "text": "Tell me more about that."},
    {"turn_index": 4, "role": "client", "text": "Everything feels heavy."},
    {"turn_index": 5, "role": "counselor", "text": "That sounds hard."},
]

EVIDENCE = {
    "behaviours": [
        {
            "skill": "open questions",
            "opportunity": True,
            "observation": "observed",
            "confidence": "high",
            "importance": 3,
            "turn_index": 1,
            "quote": "What brings you in today?",
            "note": "Opened well.",
        },
        {
            "skill": "exploring risk",
            "opportunity": True,
            "observation": "missed",
            "confidence": "high",
            "importance": 2,
            "note": "Did not ask.",
        },
    ],
    "pivotal_moments": [
        {
            "turn_index": 2,
            "summary": "client signals hopelessness",
            "why_it_matters": "x",
        },
        {
            "turn_index": 4,
            "summary": "client describes heaviness",
            "why_it_matters": "y",
        },
    ],
}

CARDS = {
    "opening": "You stayed with the client.",
    "important_moment": None,
    "what_worked": [
        {
            "skill": "open questions",
            "turn_index": 1,
            "quote": "What brings you in today?",
            "lead": "l",
            "body": "b",
        }
    ],
    "work_on_this": [
        {
            "skill": "exploring risk",
            "turn_index": 2,
            "quote": "I don't see the point anymore.",
            "lead": "l",
            "why": "w",
            "try_saying": "t",
            "scenario_id": 41,
        }
    ],
    "practise_next": {"skill": "exploring risk", "reason": "r", "scenario_id": 41},
    "skill_words": [],
    "reflective_question": "q",
    "progress_note": None,
}

REVISED = {**CARDS, "opening": "Revised opening."}


def evaluation(score: int = 9, hard_fails=None, fixes=None) -> Dict[str, Any]:
    return {
        "risk_cues": [],
        "dimensions": [
            {"dimension": d, "score": score, "reasoning": "ok"} for d in DIMENSIONS
        ],
        "hard_fails": hard_fails or [],
        "fixes": fixes or [],
    }


def step(name: str, model: str, backup: Optional[str] = None, label: str = "") -> Dict:
    return {"step": name, "model": model, "backupModel": backup, "label": label or name}


STANDARD_STEPS = [
    step("safety_reader", "safety-m", "safety-b", "Reading for safety"),
    step("analyst", "analyst-m", "analyst-b", "Reading the session"),
    step("progress_reader", "progress-m", None, "Looking back"),
    step("guidance_lookup", None, None, "Finding guidance"),
    step("writer", "writer-m", "writer-b", "Writing"),
    step("checks", None, None, "Checking"),
    step("evaluator", "eval-m", "eval-b", "Scoring"),
    step("reviser", "reviser-m", "reviser-b", "Revising"),
]


ALL_AGENTS = [
    "analyst",
    "progress_reader",
    "guidance_lookup",
    "case_memory",
    "assessment_anchoring",
    "protocol_check",
    "history_deep",
    "language_specialist",
    "cohort_comparison",
    "course_patterns",
]


def orchestrated_bundle(agents=None, **orchestrator: Any) -> Dict[str, Any]:
    """A challenger release: today's recipes plus the orchestrator block."""
    b = bundle()
    b["orchestrator"] = {
        "enabled": True,
        "plannerModel": "planner-m",
        "plannerBackupModel": None,
        "topUp": True,
        "maxAgentsPerPlan": 6,
        "agents": [
            {"id": a, "version": 1, "model": "agent-m"}
            for a in (ALL_AGENTS if agents is None else agents)
        ],
        **orchestrator,
    }
    return b


def bundle(**settings: Any) -> Dict[str, Any]:
    short_steps = [
        s
        for s in STANDARD_STEPS
        if s["step"] in ("safety_reader", "writer", "checks", "evaluator")
    ]
    return {
        "recipes": {
            "standard": {
                "key": "standard",
                "steps": STANDARD_STEPS,
                "maxRevisionRounds": 2,
                "shortForm": False,
            },
            "short": {
                "key": "short",
                "steps": short_steps,
                "maxRevisionRounds": 0,
                "shortForm": True,
            },
        },
        "prompts": {},
        "settings": {
            "standardMinLearnerTurns": 3,
            "passScore": 8,
            "runCeilingUsd": 0.5,
            "deadlineMs": 150_000,
            "riskDeadlineMs": 180_000,
            "guidancePassagesPerMoment": 2,
            **settings,
        },
    }


CHEAP = {"input_per_m": 0.1, "output_per_m": 0.4}
PRICES = {
    m: CHEAP
    for m in [
        "safety-m",
        "safety-b",
        "analyst-m",
        "analyst-b",
        "progress-m",
        "writer-m",
        "writer-b",
        "eval-m",
        "eval-b",
        "reviser-m",
        "reviser-b",
        "planner-m",
        "agent-m",
    ]
}

SESSION = {
    "id": "sess-1",
    "tenant_id": "11111111-1111-1111-1111-111111111111",
    "counselor_id": 7,
    "status": "ENDED",
    "language": "en",
    "language_source": "recorded",
    "language_recorded": True,
    "learner_level": "beginner",
    "learner_turns": 3,
    "scenario_id": 41,
    "scenario": {"title": "Exam stress", "description": "A student"},
    "expected_behaviours": ["open questions", "exploring risk"],
    "assessment": False,
    "in_case": False,
}


def obs(run_id, date, observation, version=2, turn=3, corrected=False, opp=True):
    return {
        "run_id": run_id,
        "date": date,
        "opportunity": opp,
        "observation": observation,
        "confidence": "high",
        "turn_index": turn,
        "analyst_version": version,
        "corrected": corrected,
    }


#: PROGRESS_CONTRACT §1: three earlier sessions, empathy rising.
PROGRESS_PROFILE = {
    "settings": {
        "window": 6,
        "cardEvery": 5,
        "useFhs": True,
        "showWorseToLearners": False,
    },
    "session_number": 5,
    "card_due": True,
    "sessions": [
        {
            "session_id": f"s-{i}",
            "run_id": f"r-{i}",
            "date": f"2026-11-0{i}",
            "scenario": {"title": "Exam stress", "difficulty": "easy", "risk": False},
            "analyst_version": 2,
            "practise_next": None,
        }
        for i in (3, 2, 1)
    ],
    "skills": {
        "empathy": [
            obs("r-1", "2026-11-01", "missed"),
            obs("r-2", "2026-11-02", "partial"),
            obs("r-3", "2026-11-03", "observed"),
        ],
        "other": [obs("r-1", "2026-11-01", "observed")],
    },
    "past_points": [
        {
            "run_id": "r-3",
            "date": "2026-11-03",
            "skill": "Empathy, warmth and genuineness",
            "point": "Name the feeling you hear.",
            "verdict": "agreed",
            "learner_flag": None,
        }
    ],
    "last_report": None,
    "learner_voice": [],
    "fhs": None,
}

#: What the progress agent proposes by default (before the vetoes).
PROGRESS_REPORT = {
    "skills": [
        {
            "skill": "empathy",
            "trend": "more_consistent",
            "why": "Missed, then partial, then observed twice.",
            "evidence": [
                {"run_id": "r-1", "turn_index": 3},
                {"run_id": "this", "turn_index": 5},
            ],
            "fhs": "absent",
            "learner_line": "You named the client's feelings more often lately.",
        }
    ],
    "followups": [
        {
            "point": "Name the feeling you hear.",
            "status": "done",
            "evidence": [{"run_id": "this", "turn_index": 5}],
        }
    ],
    "focus": {
        "skill": "harm",
        "why": "Risk was not explored.",
        "learner_line": "Next time, ask gently about safety.",
        "practise_next": True,
    },
    "shown_as": "card",
}

CONTEXT = {
    "live_detections": [{"behaviour": "open questions", "detected": True, "times": 1}],
    "past_work_on_this": [
        {"date": "2026-10-20", "skill": "pacing", "point": "Let the client finish."}
    ],
    "cohort": None,
    "case_memory": None,
    "practice_options": [
        {"id": 41, "title": "Exam stress", "skills": ["exploring risk"]}
    ],
    "progress_profile": PROGRESS_PROFILE,
}


class FakeSteps:
    """Answers each step; `fail[path]` = how many attempts fail first (or
    `"always"`); `answers[path]` overrides the answer (a callable gets the body)."""

    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.fail: Dict[str, Any] = {}
        self.answers: Dict[str, Any] = {}
        self.delay: Dict[str, float] = {}

    def count(self, path: str) -> int:
        return len([c for c in self.calls if c["path"] == path])

    def models(self, path: str) -> List[Optional[str]]:
        return [c["model"] for c in self.calls if c["path"] == path]

    async def run(self, path, body, model, session_id):
        self.calls.append({"path": path, "model": model, "body": body})
        delay = self.delay.get(path)
        if delay and self.count(path) == 1:
            await asyncio.sleep(delay)
        fail = self.fail.get(path)
        if fail == "always" or (isinstance(fail, int) and self.count(path) <= fail):
            raise StepError(502, f"{path} returned no usable answer")
        answer = self.answers.get(path)
        if callable(answer):
            answer = answer(body)
        if answer is None:
            answer = self.default(path, body)
        return {"model": model, **answer}

    @staticmethod
    def default(path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "safety-reader": {"risk_cues": [], "learner_distress": []},
            "analyst": {"evidence": EVIDENCE, "reasoning": "Weighed the turns."},
            "progress-reader": {
                "progress": {
                    "items": [{"skill": "pacing", "trend": "too_early", "evidence": ""}]
                },
                "reasoning": "",
            },
            "progress-agent": {
                "report": PROGRESS_REPORT,
                "reasoning": "Empathy rose across the window.",
            },
            "writer": {"cards": CARDS, "reasoning": "Led with risk."},
            "evaluator": {"evaluation": evaluation(9), "reasoning": "Good."},
            "reviser": {"cards": REVISED, "reasoning": "Fixed the quote."},
            "planner": {
                "plan": {
                    "actions": [
                        {
                            "agent": "guidance_lookup",
                            "why": "A pivotal moment.",
                            "focus_turns": [],
                        },
                    ],
                    "considered": [],
                },
                "reasoning": "Planned from the profile.",
            },
        }.get(path) or {
            # A prompt-only registry agent (`agent-<id>`).
            "findings": [
                {
                    "kind": "context",
                    "point": f"{path} found something.",
                    "turn_index": 2,
                    "quote": "I don't see the point anymore.",
                    "importance": 1,
                    "confidence": "high",
                    "source": None,
                }
            ],
            "reasoning": f"{path} read it.",
        }


class FakeGateway:
    """ally-be's tools. `checks` is a queue of failure lists, one per draft."""

    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.checks: List[List[Dict[str, Any]]] = []
        self.progress_error: Optional[Exception] = None
        self.raise_on: Dict[str, Callable[[], Exception]] = {}
        self.answers: Dict[str, Any] = {}
        self.closed = False

    def tools(self, name: str) -> List[Dict[str, Any]]:
        return [c["body"] for c in self.calls if c["tool"] == name]

    async def call(self, tool: str, body: Dict[str, Any]) -> Dict[str, Any]:
        self.calls.append({"tool": tool, "body": body})
        if tool in self.raise_on:
            raise self.raise_on[tool]()
        if tool == "progress":
            if self.progress_error:
                raise self.progress_error
            return {"ok": True}
        if tool == "guidance_search":
            situation = body["topics"][0]["situation"]
            return {
                "passages": [
                    {
                        "id": f"g-{situation}",
                        "code": "DG-1",
                        "title": f"Guide on {situation}",
                        "text": "Ask directly.",
                        "citation": "Guide",
                        "band": "strong",
                    }
                ],
                "no_confident_match": False,
            }
        if tool == "run_checks":
            failures = self.checks.pop(0) if self.checks else []
            return {"failures": failures, "advisory": ["total_too_long"]}
        if tool == "render_cards":
            return {"text": "rendered: " + body["cards"]["opening"]}
        if tool == "finalise_cards":
            return {"cards": {**body["cards"], "point_ids": True}}
        if tool in self.answers:
            answer = self.answers[tool]
            return answer(body) if callable(answer) else answer
        if tool == "get_org_protocols":
            return {
                "protocols": [
                    {"code": "DG-9", "title": "Refer on self-harm", "text": "Refer."}
                ],
                "procedures": None,
            }
        if tool == "get_learner_history":
            return {
                "sessions": [
                    {"date": f"2026-10-0{i}", "work_on_this": [{"skill": "pacing"}]}
                    for i in range(1, 5)
                ]
            }
        if tool == "query_aggregates":
            return {"rows": [], "min_group": 5}
        raise GatewayError(tool, 404, "unknown tool")

    async def aclose(self) -> None:
        self.closed = True


def make_ctx(steps: FakeSteps, gateway: FakeGateway, **overrides: Any):
    kwargs: Dict[str, Any] = dict(
        run_id="run-1",
        session_id="sess-1",
        bundle=bundle(),
        prompts={"debrief_writer_system": "Write well."},
        ceiling_usd=0.5,
        prices=dict(PRICES),
        session=dict(SESSION),
        transcript=list(TRANSCRIPT),
        inputs=dict(CONTEXT),
        steps=steps,
        gateway=gateway,
    )
    kwargs.update(overrides)
    return DebriefRunContext(**kwargs)


def new_graph():
    return build_graph(InMemorySaver())


async def run(steps, gateway, graph=None, resume=False, **overrides):
    graph = graph or new_graph()
    result = await run_debrief(
        graph, make_ctx(steps, gateway, **overrides), resume=resume
    )
    await asyncio.sleep(0)  # let fire-and-forget progress calls land
    return result


def names(result) -> List[str]:
    return [f"{s['step']}:{s['status']}" for s in result["steps"]]
