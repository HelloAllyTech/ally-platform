"""Chunk 08: model-backed lenses and falsifier with scripted models (no network)."""

from __future__ import annotations

from contextlib import contextmanager

from bug_hunter.signals import commit_sweep as cs
from bug_hunter.signals.sweep_models import LensAnswer, LensItem, ModelSweep
from tests.fakes import ScriptedChatModel, ai, structured
from tests.test_graph_chunk06 import _deps, _isolated_caches, repo  # noqa: F401

DIFF = "diff --git a/ally-be/src/x.ts b/ally-be/src/x.ts\n-  return 3;\n+  return 0;\n"


def item(title, safety=False, confidence="medium"):
    return LensItem(
        title=title,
        category="logic",
        severity="high" if safety else "medium",
        files=["ally-be/src/x.ts"],
        evidence=["ally-be/src/x.ts:2 — returns 0"],
        hypothesis="h",
        confidence=confidence,
        safety=safety,
    )


def verdict(v, c="medium", reason="checked x.ts:2"):
    return ai(
        tool_calls=[
            {
                "name": "submit_verdict",
                "args": {"verdict": v, "confidence": c, "reason": reason},
            }
        ]
    )


def sweep_deps(config, repo, tmp_path, lens_answers, falsifier_script):
    deps = _deps(config, repo, tmp_path, [], output_mode="suggested_fix")
    deps.models["lens"] = ScriptedChatModel(
        script=[structured(a, model="gpt-5-mini") for a in lens_answers]
    )
    deps.models["falsifier"] = ScriptedChatModel(script=falsifier_script)
    return deps


EMPTY = LensAnswer(findings=[])


def test_lenses_render_the_diff_and_falsifier_filters(config, repo, tmp_path) -> None:
    deps = sweep_deps(
        config,
        repo,
        tmp_path,
        [
            LensAnswer(findings=[item("x returns 0"), item("weak")]),
            EMPTY,
            EMPTY,
            EMPTY,
            EMPTY,
        ],
        [verdict("survives"), verdict("refuted", reason="guard at x.ts:1")],
    )
    model = ModelSweep(deps, DIFF)
    batch = cs.SweepBatch(app="ally-be", commits=["c" * 40], files=["ally-be/src/x.ts"])
    cands = cs.collect([batch], model, model)
    assert [c.title for c in cands] == ["x returns 0"]
    first_lens_prompt = str(deps.models["lens"].calls[0][0].content)
    assert "return 0;" in first_lens_prompt and "**logic**" in first_lens_prompt
    assert len(deps.models["lens"].calls) == 5  # one call per lens
    assert model.budget.cost_usd > 0  # both models were charged


def test_safety_findings_go_to_a_human_even_when_refuted(
    config, repo, tmp_path
) -> None:
    deps = sweep_deps(
        config,
        repo,
        tmp_path,
        [
            LensAnswer(findings=[item("crisis threshold raised", safety=True)]),
            EMPTY,
            EMPTY,
            EMPTY,
            EMPTY,
        ],
        [verdict("refuted", reason="config default still 0.7")],
    )
    batch = cs.SweepBatch(app="ally-be", commits=["d" * 40], files=["ally-be/src/x.ts"])

    @contextmanager
    def runner_for(b):
        yield ModelSweep(deps, DIFF)

    cands, cost = cs.collect_with([batch], runner_for)
    (c,) = cands
    assert c.title.startswith("[safety] ") and c.extra["human_only"] is True
    assert c.extra["falsifier"] == "refuted" and "routed to a human" in c.summary
    assert cost > 0


def test_no_verdict_means_not_trusted(config, repo, tmp_path) -> None:
    deps = sweep_deps(
        config,
        repo,
        tmp_path,
        [EMPTY],
        [ai("I think it is fine.")] * 12,  # never calls submit_verdict
    )
    model = ModelSweep(deps, DIFF)
    v, conf, _ = model.check(
        "ally-be",
        cs.LensFinding(
            "logic",
            "t",
            "logic",
            "medium",
            ["ally-be/src/x.ts"],
            ["x.ts:2"],
            "h",
            "medium",
        ),
    )
    assert (v, conf) == ("refuted", "low")
