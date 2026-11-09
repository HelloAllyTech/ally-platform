"""Token counting overestimates offline and budgets carry a safety margin."""

from __future__ import annotations

from bug_hunter.context.tokens import (
    effective_budget,
    make_counter,
    offline_counter,
    truncate_to_tokens,
)


def test_offline_counter_overestimates() -> None:
    count = offline_counter(3)
    text = "def f(x):\n    return x + 1\n" * 20
    assert count(text) == -(-len(text) // 3)  # ceil(chars / 3)
    assert count(text) > len(text) / 4  # above the usual ~4 chars/token
    assert count("") == 0


def test_make_counter_without_tiktoken_cache_is_the_estimate(monkeypatch) -> None:
    monkeypatch.setenv("TIKTOKEN_CACHE_DIR", "/nonexistent/tiktoken")
    monkeypatch.delenv("BUGHUNTER_TIKTOKEN_DOWNLOAD", raising=False)
    from bug_hunter.context import tokens

    tokens._tiktoken_encoding.cache_clear()
    counter, source = make_counter(3)
    assert source == "estimate" and counter("abcdef") == 2
    tokens._tiktoken_encoding.cache_clear()


def test_effective_budget_applies_margin() -> None:
    assert effective_budget(1000, 0.15) == 850
    assert effective_budget(10, 0.99) == 1


def test_truncate_whole_lines_with_marker() -> None:
    count = offline_counter(3)
    text = "\n".join(f"line {i}" for i in range(50))
    out = truncate_to_tokens(text, 30, count)
    assert out.endswith("… (truncated to fit budget)")
    assert count(out) <= 30
    assert all(
        line.startswith("line ") or line.startswith("…") for line in out.splitlines()
    )
    assert truncate_to_tokens("short", 100, count) == "short"
