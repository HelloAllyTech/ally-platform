"""cases.yaml schema rules, selection, metrics arithmetic and the report table."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from evals.metrics import CaseResult, Metrics, aggregate, render_markdown
from evals.schema import Case, CaseFile, load_cases, save_cases


def _bug(**over) -> Case:
    base = dict(
        id="ally-be-abc12345",
        kind="bug",
        app="ally-be",
        parent="a" * 40,
        commit="b" * 40,
        expected="fix",
        description="Users cannot save a note when the title is empty",
        src_files=["src/x.ts"],
        oracle_tests=["src/x.spec.ts"],
    )
    base.update(over)
    return Case(**base)


def test_schema_rules() -> None:
    assert _bug().expected == "fix"
    assert _bug(risk=True, expected="escalate").risk
    with pytest.raises(ValidationError, match="needs oracle_tests"):
        _bug(oracle_tests=[])
    with pytest.raises(ValidationError, match="must expect escalate"):
        _bug(risk=True, expected="fix")
    with pytest.raises(ValidationError, match="cannot expect no_bug"):
        _bug(expected="no_bug")
    with pytest.raises(ValidationError, match="must expect no_bug"):
        _bug(kind="clean", expected="fix", oracle_tests=[])
    clean = _bug(
        id="ally-be-clean001", kind="clean", expected="no_bug", oracle_tests=[]
    )
    assert clean.kind == "clean"
    with pytest.raises(ValidationError, match="duplicate case ids"):
        CaseFile(cases=[_bug(), _bug()])


def test_select_and_roundtrip(tmp_path: Path) -> None:
    cases = CaseFile(
        cases=[
            _bug(),
            _bug(id="ally-ai-aaaaaaaa", app="ally-ai"),
            _bug(
                id="ally-ai-clean",
                app="ally-ai",
                kind="clean",
                expected="no_bug",
                oracle_tests=[],
            ),
        ]
    )
    assert [c.id for c in cases.select("ally-ai")] == [
        "ally-ai-aaaaaaaa",
        "ally-ai-clean",
    ]
    assert [c.id for c in cases.select("clean")] == ["ally-ai-clean"]
    assert [c.id for c in cases.select("ally-be-abc12345,ally-ai-clean")] == [
        "ally-be-abc12345",
        "ally-ai-clean",
    ]
    assert len(cases.select(None)) == 3
    assert cases.by_app() == {
        "ally-be": {"bug": 1, "clean": 0},
        "ally-ai": {"bug": 1, "clean": 1},
    }
    path = tmp_path / "cases.yaml"
    save_cases(path, cases)
    again = load_cases(path)
    assert [c.id for c in again.cases] == [c.id for c in cases.cases]
    assert path.read_text().startswith("# Golden cases")
    assert load_cases(tmp_path / "missing.yaml").cases == []


def test_metrics_aggregate_and_rates() -> None:
    results = [
        CaseResult(
            "b1",
            "ally-be",
            "bug",
            "fix",
            "detected",
            found=True,
            repro_valid=True,
            oracle_pass=True,
            tokens=10,
            cost_usd=0.5,
        ),
        CaseResult("b2", "ally-be", "bug", "fix", "missed"),
        CaseResult(
            "b3", "ally-be", "bug", "escalate", "escalated_correctly", escalated=True
        ),
        CaseResult(
            "b4",
            "ally-ai",
            "bug",
            "escalate",
            "detected",
            found=True,
            repro_valid=False,
            oracle_pass=False,
        ),
        CaseResult("c1", "ally-ai", "clean", "no_bug", "clean"),
        CaseResult("c2", "ally-ai", "clean", "no_bug", "false_alarm", found=True),
        CaseResult("e1", "ally-ai", "clean", "no_bug", "error", error="boom"),
    ]
    m = aggregate(results)
    total: Metrics = m["total"]
    assert (total.cases, total.bugs, total.clean) == (7, 4, 3)
    assert total.rates() == {
        "detection": 0.75,  # b1, b3, b4 of 4
        "false_alarm": round(1 / 3, 3),
        "reproduction": 0.5,  # b1 valid, b4 not
        "fix_pass": 0.5,
        "escalation_correct": 0.5,  # b3 yes, b4 should have escalated
        "error": round(1 / 7, 3),
    }
    assert m["ally-be"].detected == 2 and m["ally-ai"].false_alarms == 1
    assert aggregate([])["total"].rates()["detection"] is None


def test_render_markdown() -> None:
    results = [
        CaseResult(
            "b1",
            "ally-be",
            "bug",
            "fix",
            "detected",
            found=True,
            oracle_pass=True,
            seconds=3.2,
        )
    ]
    report = {
        "meta": {
            "agent": "baseline",
            "mode": "issue",
            "git_sha": "0123456789abcdef",
            "prompt_versions": "none",
            "models": {},
            "timestamp": "t",
            "cases": 1,
            "stopped_reason": None,
        },
        "metrics": {k: v.to_dict() for k, v in aggregate(results).items()},
        "cases": [r.to_dict() for r in results],
    }
    text = render_markdown(report)
    assert "# Eval report: baseline · issue mode" in text
    assert "| total | 1 | 1 | 0 | 100% | – | – | 100% | – | 0 |" in text
    assert (
        "| `b1` | bug | fix | detected | – | yes | – | 0 | – | 0 | $0.000 | 3 | – |"
        in text
    )
