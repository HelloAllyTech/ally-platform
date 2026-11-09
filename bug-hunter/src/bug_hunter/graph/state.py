"""``BugState`` and its sub-models (spec §4). Nodes return partial updates.

Large artefacts (diffs, logs, file contents) never live here: they go to the run's
artefact folder and the state keeps the path plus a short summary.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from bug_hunter.config import AppName

Mode = Literal["sweep", "issue"]
Status = Literal[
    "new",
    "triaged",
    "investigating",
    "reproduced",
    "fixing",
    "verified",
    "reviewed",
    "awaiting_human",
    "pr_opened",
    "escalated",
    "rejected",
    "closed_not_bug",
    "closed_duplicate",
    "failed",
]
Confidence = Literal["high", "medium", "low"]
Severity = Literal["critical", "high", "medium", "low"]


class Signal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["commit_sweep", "ci_failure", "error_log", "issue"]
    ref: str  # commit SHA, workflow run id, log query id, issue number
    raw_summary: str  # already PHI-scrubbed
    reported_by: Literal["agent", "ci", "monitoring", "staff", "user"]


Category = Literal[
    "logic", "crash", "error_handling", "null", "contract", "race", "security", "other"
]
CATEGORIES: tuple[str, ...] = Category.__args__  # type: ignore[attr-defined]


class Finding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    app: AppName
    title: str
    category: Category
    severity: Severity
    suspected_files: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(
        default_factory=list, description="concrete observations with file:line"
    )
    hypothesis: str


class Repro(BaseModel):
    model_config = ConfigDict(extra="forbid")

    test_path: str
    test_name: str
    command: str
    failing_output_excerpt: str  # scrubbed, truncated
    fails_for_the_right_reason: bool  # judged in the reproduce node
    failure_kind: Literal["genuine", "setup", "passed", "no_tests"] = "genuine"
    judgement: str = ""  # why the failure does / does not match the hypothesis
    file_hashes: dict[str, str] = Field(
        default_factory=dict,
        description="sha256 of each repro test file; fix may not change them",
    )


class Patch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    branch: str
    diff_path: str
    files_changed: list[str]
    lines_changed: int
    rationale: str


class Verification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    repro_passes: bool
    app_tests_pass: bool  # no *new* failures against the baseline
    lint_pass: bool
    typecheck_pass: bool
    new_failures: list[str] = Field(default_factory=list)
    baseline_failures: list[str] = Field(
        default_factory=list
    )  # pre-existing, not blamed
    repro_files_unchanged: bool = True  # hashes from reproduce still match
    commands_run: list[str] = Field(default_factory=list)
    summary: str = ""

    @property
    def passed(self) -> bool:
        return (
            self.repro_passes
            and self.app_tests_pass
            and self.lint_pass
            and self.typecheck_pass
            and self.repro_files_unchanged
        )


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verdict: Literal["approve", "request_changes", "reject"]
    issues: list[str] = Field(default_factory=list)
    regression_risks: list[str] = Field(default_factory=list)


class NodeUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    calls: int = 0
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    seconds: float = 0.0


class Budget(BaseModel):
    """What the run has spent so far. Nodes replace it with an updated copy."""

    model_config = ConfigDict(extra="forbid")

    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    wall_clock_s: float = 0.0
    per_node: dict[str, NodeUsage] = Field(default_factory=dict)

    @property
    def tokens(self) -> int:
        return self.input_tokens + self.output_tokens


class BugState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    signal: Signal
    mode: Mode = "issue"
    app: AppName | None = None
    ref: str = ""  # commit under test
    started_at: str = ""  # ISO 8601, set by intake
    finding: Finding | None = None
    no_bug_reason: str | None = None
    duplicate_of: str | None = None
    repro: Repro | None = None
    root_cause: str | None = None
    patch: Patch | None = None
    verification: Verification | None = None
    review: Review | None = None
    risk_level: Literal["low", "medium", "high", "human_only"] | None = None
    confidence: Confidence | None = None
    attempts: int = 0  # fix attempts (chunk 06)
    repro_attempts: int = 0  # submitted tests that passed or ran nothing, bounced back
    status: Status = "new"
    stop_reason: str | None = None  # budget exceeded, cannot reproduce, …
    pr_url: str | None = None
    pr_branch: str | None = None
    approval_id: str | None = None
    approval_decision: Literal["approved", "rejected"] | None = None
    approval_reason: str | None = None
    escalation_url: str | None = None
    scratchpad_path: str = ""
    artefacts: dict[str, str] = Field(default_factory=dict)  # name -> path
    trace_url: str | None = None
    budget_used: Budget = Field(default_factory=Budget)
