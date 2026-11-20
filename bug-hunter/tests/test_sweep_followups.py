"""Chunk 08 follow-ups (user, 2026-11-16): nearby comments and related commits for
the falsifier, safety only from lens_logic, grouping before the cap, retries."""

from __future__ import annotations

import pytest

from bug_hunter.graph import llm
from bug_hunter.signals import commit_sweep as cs
from bug_hunter.signals.sweep_models import (
    LensAnswer,
    LensAnswerNoSafety,
    LensItem,
    LensItemNoSafety,
    ModelSweep,
    nearby_comments,
)
from tests.fakes import ScriptedChatModel, ai, structured
from tests.test_graph_chunk06 import _deps, _isolated_caches, repo  # noqa: F401

DIFF = "diff --git a/ally-be/src/x.ts b/ally-be/src/x.ts\n"


def lf(
    title, file="ally-be/src/x.ts", severity="medium", confidence="medium", safety=False
):
    return cs.LensFinding(
        "logic",
        title,
        "logic",
        severity,
        [file],
        [f"{file}:2"],
        "h",
        confidence,
        safety,
    )


# --- (1) nearby comments -------------------------------------------------------------


def test_nearby_comments_are_extracted_from_the_code(repo) -> None:
    def read(path):
        p = repo / path
        return p.read_text() if p.exists() else None

    text = nearby_comments(read, ["src/x.ts:2 — returns 0"], "ally-be")
    assert "ally-be/src/x.ts:2" in text and "// bug" in text
    none = nearby_comments(read, ["src/missing.ts:3 — x"], "ally-be")
    assert "file not found" in none
    assert nearby_comments(read, ["no line here"], "ally-be").startswith("(no cited")


def test_falsifier_v2_sees_comments_and_related_commits(config, repo, tmp_path) -> None:
    deps = _deps(config, repo, tmp_path, [], output_mode="suggested_fix")
    deps.models["falsifier"] = ScriptedChatModel(
        script=[
            ai(
                tool_calls=[
                    {
                        "name": "submit_verdict",
                        "args": {
                            "verdict": "refuted",
                            "confidence": "medium",
                            "reason": "comment at x.ts:2 says it is intended",
                        },
                    }
                ]
            )
        ]
    )
    model = ModelSweep(deps, DIFF)
    model.related_commits = "- abc123 [ally-web] web reads the new field — apps/x.tsx"
    v, _, _ = model.check("ally-be", lf("x returns 0"))
    prompt = str(deps.models["falsifier"].calls[0][0].content)
    assert v == "refuted"
    assert "// bug" in prompt and "web reads the new field" in prompt
    assert "A comment stating that the behaviour is intended means `refuted`" in prompt


# --- (2) safety only from lens_logic -------------------------------------------------


def test_only_lens_logic_can_mark_safety(config, repo, tmp_path) -> None:
    item = dict(
        title="t",
        category="security",
        severity="high",
        files=["ally-be/src/x.ts"],
        evidence=["ally-be/src/x.ts:2 — y"],
        hypothesis="h",
        confidence="medium",
    )
    deps = _deps(config, repo, tmp_path, [], output_mode="suggested_fix")
    deps.models["lens"] = ScriptedChatModel(
        script=[
            structured(LensAnswerNoSafety(findings=[LensItemNoSafety(**item)])),
            structured(LensAnswer(findings=[LensItem(**item, safety=True)])),
        ]
    )
    model = ModelSweep(deps, DIFF)
    (sec,) = model.run("security_and_data_exposure", "ally-be", ["c" * 40])
    (logic,) = model.run("logic", "ally-be", ["c" * 40])
    assert sec.safety is False and logic.safety is True
    # the non-logic schema has no safety field at all
    assert "safety" not in LensItemNoSafety.model_fields
    with pytest.raises(Exception):
        LensItemNoSafety(**item, safety=True)


# --- (4) grouping before the falsifier cap -------------------------------------------


def test_same_file_same_theme_findings_are_grouped() -> None:
    fs = [
        lf("progress node still named progress_reader", severity="high"),
        lf("progress_reader node name mismatch with progress agent"),
        lf("budget key mismatch", file="ally-be/src/budget.ts"),
        lf("progress node still named progress_reader", file="ally-be/src/other.ts"),
    ]
    kept, grouped = cs.group_findings(fs)
    assert grouped == 1 and len(kept) == 3
    assert kept[0].severity == "high"  # the strongest of the group survives


def test_grouping_is_reported_and_frees_the_cap() -> None:
    class Lenses:
        def run(self, lens, app, commits):
            if lens != "logic":
                return []
            dupes = [lf(f"progress reader name mismatch {i}") for i in range(4)]
            distinct = [
                lf(f"distinct {i}", file=f"ally-be/src/f{i}.ts") for i in range(4)
            ]
            return dupes + distinct

    checked = []

    class Falsifier:
        def check(self, app, f):
            checked.append(f.title)
            return "refuted", "medium", "-"

    b = cs.SweepBatch("ally-be", ["c" * 40], [])
    cs.collect([b], Lenses(), Falsifier())
    assert b.grouped == 3 and len(checked) == 5 and not b.dropped


def test_related_commits_list_every_app() -> None:
    a = cs.SweepBatch(
        "ally-be",
        ["a" * 40],
        [],
        titles={"a" * 40: "be change"},
        commit_files={"a" * 40: ["ally-be/src/a.ts"]},
    )
    w = cs.SweepBatch(
        "ally-web",
        ["b" * 40],
        [],
        titles={"b" * 40: "web change"},
        commit_files={"b" * 40: [f"ally-web/f{i}.ts" for i in range(10)]},
    )
    text = cs.related_commits_text([a, w])
    assert "[ally-be] be change — ally-be/src/a.ts" in text
    assert "[ally-web] web change" in text and "(+2 more)" in text


# --- (5) retries on connection errors -------------------------------------------------


class APIConnectionError(Exception):
    pass


def test_connection_errors_retry_with_backoff(monkeypatch) -> None:
    slept = []
    monkeypatch.setattr(llm, "_sleep", slept.append)
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise APIConnectionError("Connection error.")
        return "ok"

    assert llm.invoke_with_retry(flaky) == "ok" and slept == [2.0, 8.0]


def test_gives_up_after_three_retries_and_never_retries_other_errors(
    monkeypatch,
) -> None:
    slept = []
    monkeypatch.setattr(llm, "_sleep", slept.append)

    def down():
        raise ConnectionResetError("reset")

    with pytest.raises(ConnectionResetError):
        llm.invoke_with_retry(down)
    assert slept == [2.0, 8.0, 30.0]
    slept.clear()

    def bad_request():
        raise ValueError("400 bad request")

    with pytest.raises(ValueError):
        llm.invoke_with_retry(bad_request)
    assert slept == []


def test_wrapped_connection_errors_are_recognised() -> None:
    try:
        try:
            raise ConnectionError("dns")
        except ConnectionError as inner:
            raise RuntimeError("wrapped") from inner
    except RuntimeError as outer:
        assert llm.is_connection_error(outer)
    assert not llm.is_connection_error(ValueError("x"))
