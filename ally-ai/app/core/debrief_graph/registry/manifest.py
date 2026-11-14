"""The agent registry (spec A2, v9 FR-6): every analysis agent the planner may
choose has a manifest. Human-made agents are defined in code, one module per
agent under `registry/agents/`, and register themselves at import. System-made
agents (FR-53) will be rows with the same manifest: `origin="system"`, a prompt
code, an approved model and tools already in the catalogue.

The release bundle's `orchestrator.agents` lists which agents a release enables
and at which version; an agent outside that list is never offered to the
planner, and a plan that names one is refused (recorded on the Plan record).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Dict, List, Optional, Tuple

from app.core.debrief_graph.context import DebriefRunContext as Ctx

if TYPE_CHECKING:  # pragma: no cover
    from app.core.debrief_graph.model_step import ModelStep

#: spec A2 `kind`.
KINDS = ("subagent", "tool", "data", "knowledge", "check")
#: spec A2 `scopes.reads`: what data an agent may receive. Code passes
#: nothing outside it.
SCOPES = ("session", "learner_history", "org_protocols", "aggregates", "guidance")
PRIVACY_CLASSES = ("session", "learner", "aggregate")
STATUSES = ("active", "experimental", "retired")

#: The findings contract (spec A3) as JSON Schema: every agent's `outputs`.
FINDINGS_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["agent", "findings"],
    "properties": {
        "agent": {"type": "string"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["kind", "point", "importance", "confidence"],
                "properties": {
                    "kind": {
                        "enum": [
                            "missed",
                            "done_well",
                            "risk",
                            "context",
                            "progress",
                            "comparison",
                        ]
                    },
                    "point": {"type": "string"},
                    "turnIndex": {"type": ["integer", "null"]},
                    "quote": {"type": ["string", "null"]},
                    "importance": {"type": "integer", "minimum": 1, "maximum": 3},
                    "confidence": {"enum": ["high", "medium", "low"]},
                    "source": {"type": ["string", "null"]},
                },
            },
        },
        "reasoning": {"type": ["string", "null"]},
    },
}

#: What the planner may pass an agent (spec A5 `actions[].inputs`).
PLANNER_INPUTS_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {"focus_turns": {"type": "array", "items": {"type": "integer"}}},
}

Profile = Dict[str, Any]
State = Dict[str, Any]


@dataclass(frozen=True)
class AgentManifest:
    # --- spec A2 ------------------------------------------------------------
    id: str
    version: int
    kind: str
    description: str
    use_when: str
    skip_when: str
    #: What the learner sees while it runs (FR-27); `progress_label_key` is
    #: the key the apps translate.
    progress_label: str
    progress_label_key: str
    available: Callable[[Profile], bool]
    reads: Tuple[str, ...]
    privacy_class: str
    requires: Tuple[str, ...] = ()
    prompt: Optional[str] = None
    model: Optional[str] = None
    backup_model: Optional[str] = None
    tools: Tuple[str, ...] = ()
    cost_estimate_usd: float = 0.0
    latency_estimate_ms: int = 0
    parallel_safe: bool = True
    status: str = "active"
    origin: str = "human"
    eval_suite_id: Optional[str] = None
    ai_task_id: Optional[str] = None
    inputs: Dict[str, Any] = field(default_factory=lambda: PLANNER_INPUTS_SCHEMA)
    outputs: Dict[str, Any] = field(default_factory=lambda: FINDINGS_SCHEMA)
    # --- how it runs (one of the three) -----------------------------------
    #: A model call: the shared model-step wrapper (backup model, timeout,
    #: circuit breaker, step record).
    step: Optional["ModelStep"] = None
    #: Code over data (tools, knowledge): returns the node's state update.
    run: Optional[Callable[[State, Ctx], Awaitable[Dict[str, Any]]]] = None
    #: Data for the floor's own steps, applied by the dispatcher in place
    #: (no model, no cost): returns a state update.
    apply: Optional[Callable[[State, Ctx], Dict[str, Any]]] = None
    #: The Writer already reads this agent's output in its own block (the
    #: evidence map, guidance passages, the progress reading, the case
    #: memory), so its findings are kept for the run view but left out of
    #: the Writer's generic findings section.
    writer_has_own_block: bool = False
    #: Runs in the floor whenever the orchestrator is on, before the planner,
    #: and is never offered to it (decided 2026-11-11): the Analyst, whose
    #: evidence map the Writer writes from and the planner reads a summary of,
    #: and the case memory the Analyst must read. Agents that `require` one
    #: are satisfied by the floor.
    floor: bool = False

    @property
    def node(self) -> str:
        """The graph node that runs it (separate from today's recipe nodes)."""
        return f"agent_{self.id}"

    def card(self) -> Dict[str, Any]:
        """What the planner reads about it."""
        return {
            "id": self.id,
            "description": self.description,
            "use_when": self.use_when,
            "skip_when": self.skip_when,
            "requires": list(self.requires),
            "cost_estimate_usd": self.cost_estimate_usd,
            "latency_estimate_ms": self.latency_estimate_ms,
        }

    def record(self) -> Dict[str, Any]:
        """The manifest as data (spec A2 field names), for the Console and FR-53."""
        return {
            "id": self.id,
            "version": self.version,
            "kind": self.kind,
            "description": self.description,
            "useWhen": self.use_when,
            "skipWhen": self.skip_when,
            "progressLabel": self.progress_label,
            "progressLabelKey": self.progress_label_key,
            "inputs": self.inputs,
            "outputs": self.outputs,
            "requires": list(self.requires),
            "scopes": {"reads": list(self.reads)},
            "privacyClass": self.privacy_class,
            "prompt": self.prompt,
            "model": self.model,
            "backupModel": self.backup_model,
            "tools": list(self.tools),
            "costEstimateUsd": self.cost_estimate_usd,
            "latencyEstimateMs": self.latency_estimate_ms,
            "parallelSafe": self.parallel_safe,
            "status": self.status,
            "origin": self.origin,
            "evalSuiteId": self.eval_suite_id,
            "aiTaskId": self.ai_task_id,
            "floor": self.floor,
        }


REGISTRY: Dict[str, AgentManifest] = {}


def register(m: AgentManifest) -> AgentManifest:
    if m.id in REGISTRY:
        raise ValueError(f"debrief agent {m.id} is registered twice")
    if m.kind not in KINDS or m.kind == "check":
        raise ValueError(
            f"{m.id}: kind {m.kind} cannot be planned (checks are floor-only)"
        )
    if sum(x is not None for x in (m.step, m.run, m.apply)) != 1:
        raise ValueError(f"{m.id}: exactly one of step, run or apply")
    bad = [s for s in m.reads if s not in SCOPES]
    if bad or m.privacy_class not in PRIVACY_CLASSES or m.status not in STATUSES:
        raise ValueError(f"{m.id}: unknown scope, privacy class or status")
    unknown = [r for r in m.requires if r not in REGISTRY]
    if unknown:
        raise ValueError(f"{m.id} requires {unknown}, registered after it or never")
    REGISTRY[m.id] = m
    return m


# --- the release's orchestrator block ---------------------------------------------


def orchestrator(ctx: Ctx) -> Dict[str, Any]:
    return ctx.bundle.get("orchestrator") or {}


def is_orchestrated(ctx: Ctx) -> bool:
    """The challenger flag (spec A11): off, or absent, is today's fixed recipe."""
    return orchestrator(ctx).get("enabled") is True


def release_entries(ctx: Ctx) -> Dict[str, Dict[str, Any]]:
    """The release's agent entries by id, as it lists them."""
    out: Dict[str, Dict[str, Any]] = {}
    for e in orchestrator(ctx).get("agents") or []:
        if isinstance(e, dict) and isinstance(e.get("id"), str):
            out[e["id"]] = e
    return out


def refusal(ctx: Ctx, agent: str) -> Optional[str]:
    """Why this agent may not run in this run's release, or None when it may."""
    m = REGISTRY.get(agent)
    if m is None:
        return "Refused: no such agent in the registry."
    entry = release_entries(ctx).get(agent)
    if entry is None:
        return "Refused: this release does not enable it."
    if entry.get("version") != m.version:
        return (
            f"Refused: the release enables version {entry.get('version')}, "
            f"this build has version {m.version}."
        )
    if m.status == "retired":
        return "Refused: it is retired."
    return None


def enabled(ctx: Ctx) -> List[AgentManifest]:
    """The registry agents this release enables, in registry order."""
    return [m for m in REGISTRY.values() if refusal(ctx, m.id) is None]


def agent_config(
    state: State, ctx: Ctx, agent: str, recipe_step: Optional[str] = None
) -> Dict[str, Any]:
    """`{model, backupModel, label, labelKey}` for an agent: the release's
    entry wins, then the recipe's step of the same name (today's model for
    the Analyst and the Progress reader), then the manifest."""
    m = REGISTRY[agent]
    entry = release_entries(ctx).get(agent) or {}
    recipe = (
        ctx.step_of(state["recipe_key"], recipe_step) if recipe_step else None
    ) or {}
    return {
        "model": entry.get("model") or recipe.get("model") or m.model,
        "backupModel": entry.get("backupModel")
        or recipe.get("backupModel")
        or m.backup_model,
        "label": m.progress_label,
        "labelKey": m.progress_label_key,
    }
