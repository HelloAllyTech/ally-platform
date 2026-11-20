"""open_pr (dry-run by default) and human_approval (approvals row + interrupt), plus
the step after the decision."""

from __future__ import annotations

import re
from typing import Any

from langgraph.types import interrupt

from bug_hunter.graph.approvals import Approval, expiry
from bug_hunter.graph.budget import with_clock
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.github import GitHubUnavailable, PullRequest
from bug_hunter.graph.output import pr_body, pr_title
from bug_hunter.graph.state import BugState
from bug_hunter.tools.git import branch_name


def slug_for(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug[:40].rstrip("-") or "fix"


def make_open_pr_node(deps: GraphDeps):
    def open_pr(state: BugState) -> dict[str, Any]:
        assert state.finding and state.patch and state.verification
        budget = with_clock(state.budget_used, state.started_at)
        slug = slug_for(state.finding.title)
        branch = branch_name(deps.app, slug)
        body = pr_body(state)
        title = pr_title(state)
        deps.write_artefact("pr-branch.txt", branch + "\n")
        deps.write_artefact(
            "fix.patch", open(state.patch.diff_path, encoding="utf-8").read()
        )
        client = deps.github_client()
        try:
            if deps.git is not None:
                # local branch + commit are real; only the push is behind --push
                if deps.git.current_branch(deps.worktree) != branch:
                    deps.git.create_branch(deps.worktree, deps.app, slug)
                deps.git.commit(deps.worktree, title, state.patch.files_changed)
                client.push_branch(deps.worktree, branch)
            pr = client.open_draft_pr(branch, title, body)
        except GitHubUnavailable as exc:
            return {
                "status": "escalated",
                "stop_reason": str(exc)[:400],
                "pr_branch": branch,
                "budget_used": budget,
            }
        deps.scratchpad.append_note(f"open_pr ({client.name}): {branch} -> {pr.url}")
        return {
            "pr_url": pr.url,
            "pr_branch": branch,
            "patch": state.patch.model_copy(update={"branch": branch}),
            "status": "awaiting_human",
            "budget_used": budget,
        }

    return open_pr


def make_human_approval_node(deps: GraphDeps):
    def human_approval(state: BugState) -> dict[str, Any]:
        assert state.finding and state.patch and state.repro
        store = deps.approval_store()
        if store.get(state.run_id) is None:
            store.create(
                Approval(
                    id=state.run_id,
                    app=deps.app,
                    title=state.finding.title,
                    severity=state.finding.severity,
                    risk_level=state.risk_level or "low",
                    confidence=state.confidence,
                    root_cause=state.root_cause or "",
                    repro_test=f"{state.repro.test_path}::{state.repro.test_name}",
                    files_changed=list(state.patch.files_changed),
                    pr_url=state.pr_url,
                    ci_status="dry-run" if state.pr_url == "dry-run" else "pending",
                    expires_at=expiry(deps.config.limits.approval.expiry_days),
                )
            )
            deps.scratchpad.append_note("human_approval: pending row written; waiting")
        # the run sleeps here until `bug-hunter resume <run_id> --approve|--reject`
        decision = interrupt(
            {
                "run_id": state.run_id,
                "title": state.finding.title,
                "risk_level": state.risk_level,
                "pr_url": state.pr_url,
                "resume_with": {
                    "decision": "approved|rejected",
                    "by": "<user>",
                    "reason": "<text>",
                },
            }
        )
        decided = store.decide(
            state.run_id,
            decision["decision"],
            decision.get("by", "unknown"),
            decision.get("reason", ""),
        )
        client = deps.github_client()
        pr = PullRequest(
            number=None, url=state.pr_url or "dry-run", branch=state.pr_branch or ""
        )
        budget = with_clock(state.budget_used, state.started_at)
        if decided.status == "approved":
            client.mark_ready(pr, auto_merge=deps.config.limits.pr.auto_merge)
            deps.scratchpad.append_note(
                f"approved by {decided.decided_by}: {decided.reason}"
            )
            return {
                "status": "pr_opened",
                "approval_id": decided.id,
                "approval_decision": "approved",
                "approval_reason": decided.reason,
                "budget_used": budget,
            }
        client.close_pr(pr, decided.reason or "rejected")
        deps.scratchpad.append_note(
            f"rejected by {decided.decided_by}: {decided.reason}"
        )
        return {
            "status": "rejected",
            "approval_id": decided.id,
            "approval_decision": "rejected",
            "approval_reason": decided.reason,
            "stop_reason": f"rejected by {decided.decided_by}: {decided.reason}"[:400],
            "budget_used": budget,
        }

    return human_approval
