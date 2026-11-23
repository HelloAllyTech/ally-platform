"""Chunk 08: commit sweep batching, falsifier filter and ranking (fakes, no models)."""

from __future__ import annotations

from bug_hunter.signals import commit_sweep as cs
from bug_hunter.signals.state import InMemoryState

APP_PATHS = {"ally-be": "ally-be", "ally-web": "ally-web"}
COMMITS = ["c1" * 20, "c2" * 20, "c3" * 20]
FILES = {
    COMMITS[0]: ["ally-be/src/a.ts", "docs/x.md"],
    COMMITS[1]: ["ally-web/apps/x/A.tsx", "ally-be/src/b.ts"],
    COMMITS[2]: ["README.md"],
}


def finding(title, severity="medium", confidence="medium", lens="logic"):
    return cs.LensFinding(
        lens,
        title,
        "logic",
        severity,
        ["ally-be/src/a.ts"],
        ["ally-be/src/a.ts:3 — x"],
        "h",
        confidence,
    )


def test_batches_per_app_since_the_cursor() -> None:
    seen = []

    def list_commits(since):
        seen.append(since)
        return COMMITS

    sweep, cursor = cs.batches(
        list_commits,
        FILES.__getitem__,
        InMemoryState({cs.CURSOR: "c0"}),
        APP_PATHS,
        ["ally-be", "ally-web"],
    )
    assert seen == ["c0"] and cursor == {cs.CURSOR: COMMITS[-1]}
    by_app = {b.app: b for b in sweep}
    assert by_app["ally-be"].commits == COMMITS[:2]
    assert by_app["ally-web"].files == ["ally-web/apps/x/A.tsx"]


def test_rollout_list_limits_apps() -> None:
    sweep, _ = cs.batches(
        lambda s: COMMITS, FILES.__getitem__, InMemoryState(), APP_PATHS, ["ally-be"]
    )
    assert [b.app for b in sweep] == ["ally-be"]


def test_no_runner_means_no_model_calls_and_no_candidates() -> None:
    sweep, _ = cs.batches(
        lambda s: COMMITS, FILES.__getitem__, InMemoryState(), APP_PATHS, ["ally-be"]
    )
    assert cs.collect(sweep, None, None) == []


def test_only_medium_survivors_become_ranked_candidates() -> None:
    class Lenses:
        def run(self, lens, app, commits):
            if lens == "logic":
                return [
                    finding("low one", "low"),
                    finding("refuted one"),
                    finding("weak survivor"),
                    finding("high one", "high"),
                ]
            return []

    class Falsifier:
        def check(self, app, f):
            if f.title == "refuted one":
                return "refuted", "medium", "guard at a.ts:1"
            if f.title == "weak survivor":
                return "survives", "low", "not traced"
            return "survives", "medium", "traced"

    sweep, _ = cs.batches(
        lambda s: COMMITS, FILES.__getitem__, InMemoryState(), APP_PATHS, ["ally-be"]
    )
    cands = cs.collect(sweep, Lenses(), Falsifier())
    assert [c.title for c in cands] == ["high one", "low one"]  # ranked, filtered
    assert all(c.source == "commit_sweep" and c.reported_by == "agent" for c in cands)
    assert cands[0].key.startswith(f"sweep:ally-be:{COMMITS[1][:12]}:")


def test_falsifier_runs_on_at_most_five_findings_but_every_safety_one() -> None:
    checked = []

    class Lenses:
        def run(self, lens, app, commits):
            if lens != "logic":
                return []
            fs = [finding(f"f{i}", "medium") for i in range(7)]
            fs.append(finding("safety", "low"))
            fs[-1].safety = True
            return fs

    class Falsifier:
        def check(self, app, f):
            checked.append(f.title)
            return "survives", "medium", "traced"

    sweep, _ = cs.batches(
        lambda s: COMMITS, FILES.__getitem__, InMemoryState(), APP_PATHS, ["ally-be"]
    )
    cs.collect(sweep, Lenses(), Falsifier())
    assert len(checked) == 5 and "safety" in checked
    assert len(sweep[0].dropped) == 3
