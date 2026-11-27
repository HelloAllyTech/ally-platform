"""Chunk 08: CI-failure and issue signals from recorded fixtures (no network)."""

from __future__ import annotations

from datetime import datetime, timezone

from bug_hunter.signals import ci_failures, issues
from bug_hunter.signals.state import InMemoryState
from tests.signal_fakes import FixtureGitHub

NOW = datetime(2026, 11, 15, 6, 0, tzinfo=timezone.utc)
ALL = ["ally-be", "ally-web", "ally-ai", "ally-ai-learn", "ally-mobile"]


def test_ci_failures_one_candidate_per_workflow_and_test_set_with_names() -> None:
    gh = FixtureGitHub()
    cands, cursor, ignored = ci_failures.collect(gh, InMemoryState(), ALL, now=NOW)
    assert ignored == []
    by_app = {c.app: c for c in cands}
    assert set(by_app) == {"ally-be", "ally-web", "ally-ai-learn", "ally-mobile"}
    be = by_app["ally-be"]  # two runs of the same commit -> one candidate
    assert be.key == ci_failures.tests_key(
        "test-ally-be.yml", ["TokenGuard › accepts tokens with zero-width spaces"]
    )  # keyed on one test of the group
    assert be.ref.startswith("a1b2c3d4e5f6") and be.reported_by == "ci"
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
    cands, _, _ = ci_failures.collect(
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


class _Jobs(FixtureGitHub):
    """Three red ally-web commits, a red lint job and a run naming no test."""

    def __init__(self):
        super().__init__()
        pw = (
            "2026-11-25T19:25:03.3981394Z   \u2713    3 [desktop] \u203a "
            "e2e/a.e2e.ts:37:9 \u203a home \u203a overview (12.0s)\n"
            "2026-11-25T19:25:03.3981394Z   \u2718    4 [desktop] \u203a "
            "e2e/a.e2e.ts:37:9 \u203a home \u203a build: matches its baseline (11.8s)\n"
        )
        test_job = [
            {
                "name": "Browser tests (Playwright)",
                "failed_steps": ["Run browser tests"],
                "log": pw,
            }
        ]
        self.data["workflow_runs"] = {
            "test-ally-web.yml": [
                {"id": 3, "head_sha": "c" * 40, "created_at": "2026-11-15T03:00:00Z"},
                {"id": 1, "head_sha": "a" * 40, "created_at": "2026-11-15T01:00:00Z"},
                {"id": 2, "head_sha": "b" * 40, "created_at": "2026-11-15T02:00:00Z"},
            ],
            "test-ally-be.yml": [
                {"id": 4, "head_sha": "d" * 40, "created_at": "2026-11-15T04:00:00Z"},
                {"id": 5, "head_sha": "e" * 40, "created_at": "2026-11-15T05:00:00Z"},
            ],
        }
        self.data["jobs"] = {
            "1": test_job,
            "2": test_job,
            "3": test_job,
            "4": [{"name": "Lint & format", "failed_steps": ["Lint"], "log": "x"}],
            "5": [{"name": "Jest", "failed_steps": ["Run tests"], "log": "boom"}],
        }


def test_ci_failures_group_one_broken_test_across_commits() -> None:
    cands, _, ignored = ci_failures.collect(_Jobs(), InMemoryState(), ALL, now=NOW)
    (web,) = cands  # three red commits, one bug
    assert web.extra["failing_tests"] == [
        "e2e/a.e2e.ts:37:9 \u203a home \u203a build: matches its baseline"
    ]
    assert web.ref == "a" * 40  # the first commit it failed on
    assert web.extra["commits"] == ["a" * 40, "b" * 40, "c" * 40]
    assert "since aaaaaaaaaa (3 commits)" in web.title
    # the key is the test set, so tomorrow's red runs of the same test dedupe
    again, _, _ = ci_failures.collect(_Jobs(), InMemoryState(), ALL, now=NOW)
    assert again[0].key == web.key


def test_failures_sharing_any_test_are_one_bug() -> None:
    f = [
        {"sha": "1", "tests": ["a", "b"]},
        {"sha": "2", "tests": ["c"]},
        {"sha": "3", "tests": ["b", "c"]},  # joins the two groups
        {"sha": "4", "tests": ["d"]},
    ]
    groups = ci_failures.group_failures(f)
    assert [(g["names"], g["shas"], g["first"]["sha"]) for g in groups] == [
        (["a", "b", "c"], ["1", "2", "3"], "1"),
        (["d"], ["4"], "4"),
    ]


def test_ci_failures_ignore_lint_and_unnamed_failures_with_a_reason() -> None:
    _, _, ignored = ci_failures.collect(_Jobs(), InMemoryState(), ALL, now=NOW)
    assert ignored == [
        "ci: test-ally-be.yml at dddddddddd: not a test failure (Lint & format/Lint)",
        "ci: test-ally-be.yml at eeeeeeeeee: test step failed but no failing test "
        "name was found in the output",
    ]


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
    # 502: outsider opened and labelled it (its injection text never enters)
    # 504: no app
    assert any(m.startswith("#502: ignored (not opened or labelled") for m in ignored)
    assert any(m.startswith("#504: ignored (app unknown") for m in ignored)
    # 505 has no bug label, 506 is a PR: silently skipped
    assert not any("#505" in m or "#506" in m for m in ignored)
    assert cursor == {issues.CURSOR: "2026-11-15T06:00:00+00:00"}
