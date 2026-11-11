"""No prompt may contain a file, symbol or distinctive string from an eval case's
diff (accepted, disputed or dropped near-duplicate): examples that quote the golden
set would teach the agent the answers the evals measure."""

from __future__ import annotations

import pytest

from bug_hunter.config import DEFAULT_REPO_ROOT
from bug_hunter.graph.prompts import PROMPTS_DIR
from evals.leaks import eval_case_terms, leaks_in, terms_from_diff


def test_terms_from_diff_picks_distinctive_things_only() -> None:
    diff = (
        "diff --git a/ally-be/src/prompt/util/translation-token-guard.util.ts b/x\n"
        "+const PLACEHOLDER_RE = /x/;\n+  expect(result).toBe('[laughs]');\n"
        "+const value = parsed + 1; // generic\n"
    )
    terms = terms_from_diff(diff)
    assert "translation-token-guard.util" in terms and "placeholder_re" in terms
    assert "[laughs]" in terms
    assert "generic" not in terms
    words = terms_from_diff(
        "diff --git a/x b/x\n+// Regression: Authorization header\n"
    )
    assert "regression" not in words and "authorization" not in words
    assert "value" not in terms and "parsed" not in terms and "expect" not in terms


@pytest.fixture(scope="module")
def case_terms():
    if not (DEFAULT_REPO_ROOT / ".git").exists():
        pytest.skip("needs the ally-platform git history")
    return eval_case_terms(DEFAULT_REPO_ROOT)


def test_prompts_do_not_leak_eval_cases(case_terms) -> None:
    assert len(case_terms) >= 50  # 49 cases + 3 dropped near-duplicates
    leaks = {}
    for path in sorted(PROMPTS_DIR.glob("*.md")):
        found = leaks_in(path.read_text(encoding="utf-8"), case_terms)
        if found:
            leaks[path.name] = found
    assert not leaks, f"prompt examples mention eval-case code: {leaks}"
