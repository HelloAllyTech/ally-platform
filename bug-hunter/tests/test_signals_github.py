"""Chunk 08: CI-failure and issue signals from recorded fixtures (no network)."""

from __future__ import annotations

from datetime import datetime, timezone

from bug_hunter.signals import ci_failures, issues
from bug_hunter.signals.state import InMemoryState
from tests.signal_fakes import FixtureGitHub

NOW = datetime(2026, 11, 15, 6, 0, tzinfo=timezone.utc)
ALL = ["ally-be", "ally-web", "ally-ai", "ally-ai-learn", "ally-mobile"]


def test_ci_failures_one_candidate_per_workflow_and_commit_with_test_names() -> None:
    gh = FixtureGitHub()
    cands, cursor = ci_failures.collect(gh, InMemoryState(), ALL, now=NOW)
    by_app = {c.app: c for c in cands}
    assert set(by_app) == {"ally-be", "ally-web", "ally-ai-learn", "ally-mobile"}
    be = by_app["ally-be"]  # two runs of the same commit -> one candidate
    assert be.key == "ci:test-ally-be.yml:a1b2c3d4e5f6" and be.reported_by == "ci"
    assert be.extra["failing_tests"] == [
        "TokenGuard › accepts tokens with zero-width spaces"
    ]
    assert "jane.doe@example.com" not in be.summary  # test output is scrubbed
    assert by_app["ally-web"].extra["failing_tests"][0].startswith("trims history")
    assert by_app["ally-ai-learn"].extra["failing_tests"] == [
        "tests/unit/tts/test_sarvam.py::test_skips_whitespace"
    ]
    assert by_app["ally-mobile"].extra["failing_tests"] == [
        "test/widgets/card_test.dart: SimulationCard shows difficulty"
    ]
    assert cursor == {ci_failures.CURSOR: "2026-11-15T06:00:00+00:00"}
    # the default window is the last day; only master failures are asked for
    assert (
        "runs",
        "test-ally-be.yml",
        "master",
        "failure",
        "2026-11-14T06:00:00+00:00",
    ) in gh.calls


def test_ci_failures_respect_the_rollout_app_list() -> None:
    cands, _ = ci_failures.collect(
        FixtureGitHub(), InMemoryState(), ["ally-be"], now=NOW
    )
    assert {c.app for c in cands} == {"ally-be"}


def test_ci_cursor_is_used_when_set() -> None:
    gh = FixtureGitHub()
    ci_failures.collect(
        gh,
        InMemoryState({ci_failures.CURSOR: "2026-11-15T00:30:00+00:00"}),
        ALL,
        now=NOW,
    )
    assert gh.calls[0][-1] == "2026-11-15T00:30:00+00:00"


def test_issue_signals_only_from_org_members_and_scrubbed() -> None:
    cands, cursor, ignored = issues.collect(
        FixtureGitHub(), InMemoryState(), ALL, now=NOW
    )
    got = {c.ref: c for c in cands}
    # 501: member opened it; 503: outsider opened, member labelled it bug
    assert set(got) == {"501", "503"}
    assert got["501"].app == "ally-web" and got["501"].reported_by == "staff"
    assert got["503"].app == "ally-ai-learn" and got["503"].reported_by == "user"
    assert "98765 43210" not in got["501"].summary
    # 502: outsider opened and labelled (prompt-injection text never enters); 504: no app
    assert any(m.startswith("#502: ignored (not opened or labelled") for m in ignored)
    assert any(m.startswith("#504: ignored (app unknown") for m in ignored)
    # 505 has no bug label, 506 is a PR: silently skipped
    assert not any("#505" in m or "#506" in m for m in ignored)
    assert cursor == {issues.CURSOR: "2026-11-15T06:00:00+00:00"}
