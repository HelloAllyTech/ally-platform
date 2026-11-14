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
    "challenging",  # review.v4 proposed counterexamples; code runs them next
    "awaiting_human",
    "pr_opened",
    "suggested_fix",  # output_mode suggested_fix: a verified fix, reported, no PR
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
    lint_excerpt: str = ""  # scrubbed tail, only when lint failed
    typecheck_excerpt: str = ""
    repro_excerpt: str = ""

    @property
    def passed(self) -> bool:
        return (
            self.repro_passes
            and self.app_tests_pass
            and self.lint_pass
            and self.typecheck_pass
            and self.repro_files_unchanged
        )


class ProposedCounterexample(BaseModel):
    """A reviewer's test (review.v4): an input from the finding's class that the fix
    still gets wrong. Code runs it; only a genuine failure can send the fix back."""

    model_config = ConfigDict(extra="forbid")

    test_name: str = Field(description="The test's name exactly as declared in code")
    code: str = Field(
        description="The complete test file, same framework and directory as the "
        "reproduction test, reusing its imports and setup"
    )
    claim: str = Field(description="One line: the input and what goes wrong")


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # v3: approve | request_changes | reject; v4: approve | reject_drift |
    # counterexamples
    verdict: Literal[
        "approve", "request_changes", "reject", "reject_drift", "counterexamples"
    ]
    issues: list[str] = Field(default_factory=list)
    regression_risks: list[str] = Field(default_factory=list)
    counterexamples: list[ProposedCounterexample] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)  # never block the fix


CounterexampleStatus = Literal[
    "proposed",  # not run yet
    "dropped",  # bad shape, passes or setup-fails on the buggy code, wrong reason
    "kept",  # fails on the buggy code for the reported problem; not yet run on a fix
    "passed",  # kept, and passes with the current fix
    "failed",  # kept, and fails with the current fix: the fix goes back
    "disputed",  # failed, and the fixer disputed it against the report/finding
]


class Counterexample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str  # ce<N>, stable across attempts
    test_path: str  # app-relative file code chose next to the repro test
    test_name: str
    code: str  # scrubbed
    claim: str
    proposed_at_attempt: int
    status: CounterexampleStatus = "proposed"
    reason: str = ""  # why dropped / the judge's why / the failure on the fix
    failure_excerpt: str = ""  # the latest genuine failure (buggy code or fix)
    dispute_reason: str = ""
    failed_on_fix: int = 0  # how many fixes it failed against


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
    review_verdicts: list[str] = Field(default_factory=list)  # every review, in order
    counterexamples: list[Counterexample] = Field(default_factory=list)  # review.v4
    disputed: bool = False  # a reviewer counterexample was disputed by the fixer
    recalled: list[str] = Field(default_factory=list)  # memory ids shown to nodes
    regression_of: str | None = None  # a confirmed past bug whose code changed since
    reused_from: str | None = None  # confirmed diagnosis reused; investigate skipped
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
